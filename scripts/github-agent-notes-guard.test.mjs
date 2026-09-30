import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parse } from 'yaml';

const workflow = parse(readFileSync(new URL('../.github/workflows/agent-notes-guard.yml', import.meta.url), 'utf8'));
const step = workflow.jobs['guard-agent-notes'].steps[0];

function runGuard({ files = '', association = 'NONE', sameRepo = 'false', exitCode = 0, firstPage = '', expectedFiles, inventory, records } = {}) {
  const listed = records ?? files.split(/\r?\n/).filter(Boolean).map(filename => ({ filename }));
  const output = inventory ?? JSON.stringify(listed);
  expectedFiles ??= String(listed.length);
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'dsh-agent-notes-guard-')));
  const log = path.join(directory, 'gh-args.json');
  // Execute the actual workflow shell with a fake gh; this test never contacts
  // GitHub or uses the environment's real authentication token.
  const mockGh = `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
writeFileSync(process.env.MOCK_GH_LOG, JSON.stringify(args));
process.stdout.write(args.includes('--paginate') ? process.env.MOCK_GH_OUTPUT : process.env.MOCK_GH_FIRST_PAGE, () => {
  if (Number(process.env.MOCK_GH_EXIT)) process.stderr.write('mock API retrieval failed\\n');
  process.exitCode = Number(process.env.MOCK_GH_EXIT);
});\n`;
  writeFileSync(path.join(directory, 'gh'), mockGh, { mode: 0o755 });
  try {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      encoding: 'utf8', timeout: 5000, cwd: directory,
      env: {
        ...process.env, PATH: `${directory}${path.delimiter}${process.env.PATH}`,
        GH_TOKEN: 'mock-token-not-real', REPO: 'org/plugins', PR_NUMBER: '42',
        AUTHOR_ASSOCIATION: association, SAME_REPO: sameRepo, EXPECTED_FILES: expectedFiles,
        MOCK_GH_LOG: log, MOCK_GH_OUTPUT: output, MOCK_GH_FIRST_PAGE: firstPage, MOCK_GH_EXIT: String(exitCode),
      },
    });
    assert.equal(result.error, undefined);
    return { ...result, args: existsSync(log) ? JSON.parse(readFileSync(log, 'utf8')) : [] };
  } finally {
    // Verify the exact generated temp target before removing only our fixture.
    assert.equal(path.dirname(directory), realpathSync(tmpdir()));
    assert.ok(path.basename(directory).startsWith('dsh-agent-notes-guard-'));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('guard has explicit PR-read permission and no privileged event or PR-head execution', () => {
  assert.equal(workflow.permissions['pull-requests'], 'read');
  assert.equal(workflow.permissions.contents, 'read');
  assert.ok(workflow.on.pull_request);
  assert.equal(workflow.on.pull_request_target, undefined);
  assert.equal(workflow.jobs['guard-agent-notes'].steps.length, 1);
});

for (const files of ['', 'packages/dsh-next-skills/src/index.ts\nREADME.md\n', '.agents/notes-other/note.md\nother/.agents/notes/note.md\n']) {
  test(`successful retrieval with no protected notes passes: ${JSON.stringify(files)}`, () => {
    const result = runGuard({ files });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Agent Notes tree untouched; guard passed/);
    assert.equal(result.args[0], 'api');
    assert.equal(result.args[1], 'repos/org/plugins/pulls/42/files');
    assert.ok(result.args.includes('--paginate'));
    assert.match(result.args[result.args.indexOf('--jq') + 1], /previous_filename/);
  });
}

for (const expectedFiles of ['', 'unknown', '-1', '3001', '99999999999999999999999', '$(printf unsafe)']) {
  test(`an unverifiable file inventory fails closed before API retrieval: ${JSON.stringify(expectedFiles)}`, () => {
    const result = runGuard({ expectedFiles });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /verifiable API limit/);
    assert.deepEqual(result.args, []);
    assert.doesNotMatch(result.stdout, /guard passed/);
  });
}

test('a file count at the API limit can be checked', () => {
  const result = runGuard({ expectedFiles: '3000', records: Array.from({ length: 3000 }, (_, index) => ({ filename: `src/file-${index}.ts` })) });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(result.args.includes('--paginate'));
  assert.ok(result.args.includes('--slurp'));
});

for (const mismatch of [
  { expectedFiles: '2', records: [{ filename: 'src/one.ts' }] },
  { expectedFiles: '1', records: [] },
  { expectedFiles: '0', records: [{ filename: 'src/one.ts' }] },
]) {
  test(`a successful but incomplete listing fails closed: ${mismatch.expectedFiles}/${mismatch.records.length}`, () => {
    const result = runGuard(mismatch);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /malformed or incomplete/);
    assert.doesNotMatch(result.stdout, /guard passed/);
  });
}

for (const inventory of ['not-json', '{}', '[{}]', '[{"filename":1}]', '[{"filename":"src/a.ts","previous_filename":7}]']) {
  test(`invalid file inventory fails closed: ${inventory}`, () => {
    const result = runGuard({ inventory, expectedFiles: '1' });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /malformed or incomplete/);
  });
}

test('a note beyond the first page is protected', () => {
  const result = runGuard({ firstPage: 'src/index.ts\n', files: 'src/index.ts\n.agents/notes/implemented/note.md\n' });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /Only the repository owner and collaborators/);
});

for (const association of ['NONE', 'CONTRIBUTOR', 'FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR', 'MANNEQUIN', 'owner']) {
  test(`fork note changes reject association ${association}`, () => {
    const result = runGuard({ files: '.agents/notes/implemented/note.md\n', association });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /protected Agent Notes path/);
  });
}

for (const association of ['OWNER', 'COLLABORATOR', 'MEMBER']) {
  test(`fork note changes allow existing privileged association ${association}`, () => {
    const result = runGuard({ files: '.agents/notes/implemented/note.md\n', association });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /may modify .agents\/notes; guard passed/);
  });
}

test('same-repository CONTRIBUTOR keeps existing write-access allowance', () => {
  const result = runGuard({ files: '.agents/notes/implemented/note.md\n', association: 'CONTRIBUTOR', sameRepo: 'true' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Same-repository PR/);
});

test('renaming notes out of protected directory is rejected for a fork contributor', () => {
  // gh --jq emits both current and previous names, just as the API returns them.
  const result = runGuard({ records: [{ filename: 'unprotected/note.md', previous_filename: '.agents/notes/implemented/note.md' }], association: 'CONTRIBUTOR' });
  assert.equal(result.status, 1);
});

for (const files of ['', 'src/index.ts\n', '.agents/notes/implemented/note.md\n']) {
  for (const access of [{ association: 'NONE', sameRepo: 'false' }, { association: 'OWNER', sameRepo: 'false' }, { association: 'CONTRIBUTOR', sameRepo: 'true' }]) {
    test(`gh failure fails closed despite partial output ${JSON.stringify(files)} and ${JSON.stringify(access)}`, () => {
      const result = runGuard({ files, exitCode: 1, ...access });
      assert.equal(result.status, 1);
      assert.match(result.stdout, /Could not retrieve all PR files; Agent Notes guard fails closed/);
      assert.doesNotMatch(result.stdout, /guard passed/);
    });
  }
}
