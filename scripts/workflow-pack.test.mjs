import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, stat, chmod, symlink, realpath } from 'node:fs/promises';
import { join, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { repositoryRoot, discoverPackages, planPackages, packPackages, installPackages, parseCli, runCli } from './workflow-pack.mjs';

const name = slug => '@dsh-next/dsh-next-' + slug;
const names = records => records.map(p => p.name);
const ok = stdout => ({ code: 0, stdout: stdout ?? '', stderr: '' });
async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workflow pack ')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'packages'));
  return root;
}
async function pkg(root, slug, extra = {}) {
  const dir = slug === 'shared' ? join(root, 'shared') : join(root, 'packages', 'dsh-next-' + slug);
  const manifest = { name: slug === 'shared' ? 'dsh-next-shared' : name(slug), version: '1.2.3', main: 'lib/index.js', types: 'lib/index.d.ts', exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' }, './src/*': './src/*' }, dsh: { bundle: { patch: './cordis.patch.yml' } }, scripts: { build: 'fake-build', prepare: 'fake-prepare' }, ...extra };
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), JSON.stringify(manifest));
  return manifest;
}
// Small deterministic ustar fixture writer, no shell or real package manager.
function archive(entries) {
  const chunks = [];
  for (const [path, value] of Object.entries(entries)) {
    const body = Buffer.from(value), header = Buffer.alloc(512);
    header.write('package/' + path, 0, 100);
    header.write('0000644\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116);
    header.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257);
    header.write(header.reduce((a, b) => a + b, 0).toString(8).padStart(6, '0') + '\0 ', 148);
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...chunks, Buffer.alloc(1024)]));
}
function contents(manifest, extra = {}) {
  return { 'package.json': JSON.stringify(manifest), 'lib/index.js': 'export {};', 'lib/index.d.ts': 'export {};', 'cordis.patch.yml': '[]', 'README.md': 'Read me', ...extra };
}
function packRunner(calls, mutate = files => files) {
  return async (command, args, options) => {
    calls.push({ command, args, ...options });
    if (args[0] === 'pack') {
      const manifest = JSON.parse(await readFile(join(options.cwd, 'package.json'), 'utf8'));
      await writeFile(join(args[2], 'packed.tgz'), archive(mutate(contents(manifest), manifest)));
    }
    return ok();
  };
}
async function artifactsFor(t, extras = {}) {
  const root = await fixture(t);
  await pkg(root, 'a', extras);
  const calls = [];
  const artifacts = await packPackages(await planPackages(['a'], { root }), { run: packRunner(calls) });
  return { root, artifacts, calls };
}
async function profile(root) {
  const home = join(root, 'dsh home'), dir = join(home, 'profiles', 'web');
  await mkdir(join(dir, 'node_modules'), { recursive: true });
  for (const file of ['package.json', 'pnpm-lock.yaml', 'cordis.patch.yml', 'node_modules/sentinel', '.dsh-module-fallback']) await writeFile(join(dir, file), file === 'package.json' ? JSON.stringify({ dependencies: { unrelated: '2' }, dsh: { profile: { bundles: ['unrelated'] } }, sentinel: 42 }) : 'sentinel');
  await writeFile(join(dir, 'pnpm-workspace.yaml'), '{"sentinel":42,"overrides":{"unrelated":"2"}}');
  return { home, dir };
}
function installRunner(calls, { failAdd = false, version = '0.1.3-alpha.2', overrides = '{"unrelated":"2"}', omitBundle = false } = {}) {
  return async (command, args, options) => {
    calls.push({ command, args, ...options });
    if (args[0] === '--version') return ok(version);
    if (args[0] === 'config' && args[1] === 'get') return ok(overrides);
    if (args[0] === 'config' && args[1] === 'set') {
      const path = join(options.cwd, 'pnpm-workspace.yaml');
      const previous = JSON.parse(await readFile(path, 'utf8'));
      await writeFile(path, JSON.stringify({ ...previous, overrides: JSON.parse(args.at(-1)) }));
    }
    if (args.includes('add') && !failAdd) {
      const path = join(options.cwd, 'package.json'), manifest = JSON.parse(await readFile(path, 'utf8'));
      for (const spec of args.slice(args.indexOf('add') + 1)) {
        const artifactName = name(basename(spec).split('-dsh-next-')[1].split('-1.2.3-')[0]);
        manifest.dependencies[artifactName] = spec;
        if (!omitBundle) manifest.dsh.profile.bundles.push(artifactName);
      }
      await writeFile(path, JSON.stringify(manifest));
    }
    if (args.includes('add') && failAdd) {
      await writeFile(join(options.cwd, 'partial-install'), 'package manager wrote this');
      return { code: 7, stdout: '', stderr: 'failure' };
    }
    return ok();
  };
}

test('discovery and selectors expose absolute deterministic records; shared is build-only', async t => {
  const root = await fixture(t);
  await pkg(root, 'b'); await pkg(root, 'a'); await pkg(root, 'shared');
  const records = await discoverPackages(root);
  assert.ok(isAbsolute(repositoryRoot)); assert.ok(records.every(p => isAbsolute(p.dir)));
  assert.deepEqual(names(records), [name('a'), name('b'), 'dsh-next-shared']);
  const plan = await planPackages(['b', name('a'), 'dsh-next-b'], { root });
  assert.deepEqual(names(plan.requested), [name('b'), name('a')]);
  await assert.rejects(planPackages(['shared'], { root }), /Unknown/);
  await assert.rejects(planPackages(['missing'], { root }), /Unknown/);
  await assert.rejects(planPackages([], { root }), /at least one/);
});

test('runtime required peer closure differs from dev/build-only and optional closure', async t => {
  const root = await fixture(t);
  for (const slug of ['dep', 'peer', 'dev', 'optional', 'shared']) await pkg(root, slug);
  await pkg(root, 'a', { dependencies: { [name('dep')]: '^1.0.0', external: '^1' }, peerDependencies: { [name('peer')]: '~1.2.0', [name('optional')]: 'invalid-optional', [name('missing')]: '*' }, peerDependenciesMeta: { [name('optional')]: { optional: true }, [name('missing')]: { optional: true } }, devDependencies: { [name('dev')]: 'workspace:^', 'dsh-next-shared': 'workspace:*' } });
  const plan = await planPackages(['a'], { root });
  assert.deepEqual(names(plan.packages), [name('dep'), name('peer'), name('a')]);
  assert.deepEqual(names(plan.buildPackages), [name('dep'), name('peer'), name('dev'), 'dsh-next-shared', name('a')]);
  assert.deepEqual(names((await planPackages(['a', 'dev'], { root })).packages), [name('dep'), name('peer'), name('a'), name('dev')]);
});

for (const [label, extra, message] of [
  ['missing dependency', { dependencies: { [name('missing')]: '*' } }, /Missing local/],
  ['missing peer', { peerDependencies: { [name('missing')]: '*' } }, /Missing local/],
  ['invalid range', { dependencies: { [name('dep')]: 'wat' } }, /Invalid local range/],
  ['mismatch', { dependencies: { [name('dep')]: '^2' } }, /version mismatch/],
  ['invalid version', { version: 'broken' }, /Invalid version/],
  ['self cycle', { dependencies: { [name('a')]: '*' } }, /cycle/],
  ['node incompatible', { engines: { node: '<1' } }, /requires node/],
  ['engine invalid', { dsh: { engines: { dsh: 'not-semver' } } }, /Invalid dsh/],
]) test('plan rejects ' + label, async t => {
  const root = await fixture(t); await pkg(root, 'dep'); await pkg(root, 'a', extra);
  await assert.rejects(planPackages(['a'], { root }), message);
});

test('cycles through dev prerequisites reject; optional dependencies do not force local closure', async t => {
  const root = await fixture(t);
  await pkg(root, 'a', { devDependencies: { [name('b')]: '*' } });
  await pkg(root, 'b', { dependencies: { [name('a')]: '*' } });
  await assert.rejects(planPackages(['a'], { root }), /cycle/);
  await pkg(root, 'a', { dependencies: { [name('missing')]: '*' }, optionalDependencies: { [name('missing')]: '*' } });
  assert.deepEqual(names((await planPackages(['a'], { root })).packages), [name('a')]);
});

test('pack builds all prerequisites, runs prepare through pack, hashes immutable runtime artifacts only', async t => {
  const root = await fixture(t);
  await pkg(root, 'dev'); await pkg(root, 'peer');
  await pkg(root, 'a', { devDependencies: { [name('dev')]: '*' }, peerDependencies: { [name('peer')]: '^1' } });
  const plan = await planPackages(['a'], { root }), calls = [], run = packRunner(calls);
  const before = await readFile(join(root, 'packages/dsh-next-a/package.json'));
  const artifacts = await packPackages(plan, { run, env: { PATH: '/safe', DEEPSEEK_API_KEY: 'not-forwarded' } });
  assert.deepEqual(names(artifacts), [name('peer'), name('a')]);
  assert.deepEqual(calls.filter(c => c.args[0] === 'run').map(c => basename(c.cwd)), ['dsh-next-peer', 'dsh-next-dev', 'dsh-next-a']);
  assert.equal(calls.filter(c => c.args[0] === 'pack').length, 2);
  assert.ok(calls.every(c => !c.env.DEEPSEEK_API_KEY));
  assert.deepEqual(before, await readFile(join(root, 'packages/dsh-next-a/package.json')));
  for (const artifact of artifacts) {
    assert.ok(artifact.path.includes(artifact.sha256));
    assert.equal(artifact.sha256, createHash('sha256').update(await readFile(artifact.path)).digest('hex'));
    assert.equal((await stat(artifact.path)).mode & 0o222, 0);
    assert.ok(artifact.files.includes('lib/index.d.ts'));
  }
  assert.deepEqual((await packPackages(plan, { run })).map(a => a.path), artifacts.map(a => a.path));
  const changed = await packPackages(plan, { run: packRunner([], files => ({ ...files, 'lib/index.js': 'export const changed = 1;' })) });
  assert.notEqual(changed[0].path, artifacts[0].path);
  assert.ok(!(await readdir(join(root, 'artifacts/packages'))).some(file => file.startsWith('.pack-')));
});

for (const [label, mutate, message] of [
  ['missing types', files => { delete files['lib/index.d.ts']; return files; }, /Missing exported/],
  ['identity', files => ({ ...files, 'package.json': JSON.stringify({ ...JSON.parse(files['package.json']), version: '9.0.0' }) }), /identity/],
  ['source leak', files => ({ ...files, 'src/private.ts': 'private' }), /Unexpected published/],
  ['secret leak', files => ({ ...files, 'lib/.env': 'secret' }), /Unexpected published/],
  ['unsafe path', files => ({ ...files, '../escape': '' }), /Unsafe tar/],
]) test('pack rejects ' + label + ' and removes only staging', async t => {
  const root = await fixture(t); await pkg(root, 'a');
  await assert.rejects(packPackages(await planPackages(['a'], { root }), { run: packRunner([], mutate) }), message);
  assert.deepEqual(await readdir(join(root, 'artifacts/packages')), []);
});

test('pack detects tampered existing artifacts and command failures', async t => {
  const { root, artifacts } = await artifactsFor(t);
  await chmod(artifacts[0].path, 0o644); await writeFile(artifacts[0].path, 'tampered');
  const plan = await planPackages(['a'], { root });
  await assert.rejects(packPackages(plan, { run: packRunner([]) }), /artifact was modified/);
  await assert.rejects(packPackages(plan, { run: async () => ({ code: 1 }) }), /failed/);
});

test('dry runs invoke no runner and create no artifact/home/lock directories', async t => {
  const { root, artifacts } = await artifactsFor(t);
  const run = async () => assert.fail('must not run');
  const home = join(root, 'not created');
  const output = await runCli(['install', 'a', '--home', home, '--dry-run'], { root, run });
  assert.deepEqual(output.packages, [name('a')]);
  const report = await installPackages(artifacts, { home, dryRun: true, run });
  assert.equal(report.dryRun, true);
  assert.equal(report.commands.at(-1).args.at(-1), 'file:' + artifacts[0].path);
  await assert.rejects(stat(home), { code: 'ENOENT' });
  assert.deepEqual(await packPackages(await planPackages(['a'], { root }), { dryRun: true, artifactRoot: home, run }), []);
});

test('real install merges overrides, mounts full closure, preserves sentinels, uses argv with spaces', async t => {
  const { root, artifacts } = await artifactsFor(t);
  const { home, dir } = await profile(root), calls = [];
  const before = await readFile(join(dir, 'package.json'));
  const report = await installPackages(artifacts, { home, yes: true, run: installRunner(calls), dsh: '/executable with spaces/dsh', env: { PATH: '/safe', DEEPSEEK_API_KEY: 'hidden' } });
  assert.equal(report.stage, 'complete'); assert.deepEqual(report.bundles, [name('a')]);
  assert.ok(calls.every(c => c.env.DSH_HOME === home && !c.env.DEEPSEEK_API_KEY));
  assert.deepEqual(calls.find(c => c.args.includes('add')).args, ['plugin', '--profile', 'web', 'add', 'file:' + artifacts[0].path]);
  assert.deepEqual(calls.at(-1).args, ['--profile', 'web', '--dump-config']);
  const workspace = JSON.parse(await readFile(join(dir, 'pnpm-workspace.yaml')));
  assert.deepEqual(workspace, { sentinel: 42, overrides: { unrelated: '2', [name('a')]: 'file:' + artifacts[0].path } });
  const after = JSON.parse(await readFile(join(dir, 'package.json')));
  const original = JSON.parse(before);
  assert.equal(after.sentinel, original.sentinel);
  assert.equal(after.dependencies.unrelated, original.dependencies.unrelated);
  assert.ok(after.dsh.profile.bundles.includes('unrelated'));
  for (const file of ['pnpm-lock.yaml', 'cordis.patch.yml', 'node_modules/sentinel', '.dsh-module-fallback']) assert.equal(await readFile(join(dir, file), 'utf8'), 'sentinel');
  assert.ok(!(await readdir(join(home, 'profiles'))).some(file => file.includes('.lock')));
});

test('unrelated sensitive overrides survive machine-output redaction without leaking into report', async t => {
  const { root, artifacts } = await artifactsFor(t), { home, dir } = await profile(root);
  const secret = 'synthetic-unrelated-credential';
  const original = JSON.stringify({ unrelated: 'https://registry.invalid/package?token=' + secret });
  const downstream = installRunner([]);
  const run = async (command, args, options) => {
    if (args[0] === 'config' && args[1] === 'get') {
      assert.equal(options.captureRawStdout, true);
      return Object.defineProperty(ok(original.replace(secret, '[REDACTED]')), 'rawStdout', { value: original });
    }
    return downstream(command, args, options);
  };
  const report = await installPackages(artifacts, { home, yes: true, run });
  const saved = JSON.parse(await readFile(join(dir, 'pnpm-workspace.yaml')));
  assert.equal(saved.overrides.unrelated, JSON.parse(original).unrelated);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

test('failure reports partial state without invented rollback or deleting unrelated profile data', async t => {
  const { root, artifacts } = await artifactsFor(t), { home, dir } = await profile(root);
  await assert.rejects(installPackages(artifacts, { home, yes: true, run: installRunner([], { failAdd: true }) }), error => {
    assert.equal(error.report.partial, true); assert.equal(error.report.stage, 'installing');
    assert.match(error.message, /no rollback/); return true;
  });
  assert.equal(await readFile(join(dir, 'partial-install'), 'utf8'), 'package manager wrote this');
  assert.equal(await readFile(join(dir, 'node_modules/sentinel'), 'utf8'), 'sentinel');
  assert.ok(await stat(artifacts[0].path));
  assert.ok(!(await readdir(join(home, 'profiles'))).some(file => file.includes('.lock')));
});

test('confirmation is required before commands or CLI builds; refusal and nonTTY are safe', async t => {
  const { root, artifacts } = await artifactsFor(t), home = join(root, 'uncreated');
  const run = async () => assert.fail('must not run');
  await assert.rejects(installPackages(artifacts, { home, run, isTTY: false }), /requires --yes/);
  await assert.rejects(installPackages(artifacts, { home, run, isTTY: true, confirm: async () => false }), /cancelled/);
  await assert.rejects(runCli(['install', 'a', '--home', home], { root, run, isTTY: false }), /requires --yes/);
  await assert.rejects(stat(home), { code: 'ENOENT' });
});

test('containment, profile symlinks, config symlinks and lock contention reject safely', async t => {
  const { root, artifacts } = await artifactsFor(t), run = async () => assert.fail('must not run');
  for (const profile of ['../escape', '/tmp', 'a/b', 'a b', '.', '--evil']) await assert.rejects(installPackages(artifacts, { home: root, profile, run, yes: true }), /Invalid profile/);
  for (const home of ['relative', '/']) await assert.rejects(installPackages(artifacts, { home, run, yes: true }), /absolute non-root/);
  const { home, dir } = await profile(root);
  await symlink(root, join(home, 'profiles', 'escape'));
  await assert.rejects(installPackages(artifacts, { home, profile: 'escape', run, yes: true }), /Symlink/);
  await rm(join(dir, 'pnpm-workspace.yaml')); await symlink(join(dir, 'package.json'), join(dir, 'pnpm-workspace.yaml'));
  await assert.rejects(installPackages(artifacts, { home, run, yes: true }), /Symlink/);
  await rm(join(dir, 'pnpm-workspace.yaml')); await writeFile(join(dir, 'pnpm-workspace.yaml'), '{}');
  await mkdir(join(home, 'profiles', '.workflow-web.lock'));
  await assert.rejects(installPackages(artifacts, { home, run: installRunner([]), yes: true }), /locked/);
  assert.ok(await stat(join(home, 'profiles', '.workflow-web.lock')));
});

test('install verifies actual archive identity, local peers, and engine compatibility before mutation', async t => {
  const { root, artifacts } = await artifactsFor(t, { peerDependencies: { react: '^18' } });
  const home = join(root, 'uncreated'), run = async () => assert.fail('must not run');
  await assert.rejects(installPackages([{ ...artifacts[0], sha256: 'a'.repeat(64) }], { home, run, yes: true }), /checksum/);
  await assert.rejects(installPackages([{ ...artifacts[0], version: '9.0.0' }], { home, run, yes: true }), /identity/);
  await pkg(root, 'peer'); await pkg(root, 'a', { peerDependencies: { [name('peer')]: '^1' } });
  const closure = await packPackages(await planPackages(['a'], { root }), { run: packRunner([]) });
  await assert.rejects(installPackages([closure.at(-1)], { home, run, yes: true }), /Missing local/);
  const report = await installPackages([...closure].reverse(), { home, run, dryRun: true });
  assert.deepEqual(report.bundles, [name('peer'), name('a')]);
  await pkg(root, 'a', { dsh: { engines: { dsh: '>=99' }, bundle: { patch: './cordis.patch.yml' } } });
  const incompatible = await packPackages(await planPackages(['a'], { root }), { run: packRunner([]) });
  await assert.rejects(installPackages(incompatible, { home, run: installRunner([]), yes: true }), /requires dsh/);
  await assert.rejects(stat(home), { code: 'ENOENT' });
});

test('CLI parses strict flags and paths as individual arguments', () => {
  assert.equal(parseCli(['--help']).command, 'help');
  assert.equal(parseCli(['install', '--help']).command, 'help');
  assert.deepEqual(parseCli(['--', 'pack', '--', 'a']), { command: 'pack', selectors: ['a'], options: {} });
  assert.deepEqual(parseCli(['install', 'a', 'b', '--home', '/a b', '--profile', 'dev-x', '--yes']), { command: 'install', selectors: ['a', 'b'], options: { home: '/a b', profile: 'dev-x', yes: true } });
  for (const argv of [[], ['bad'], ['pack'], ['pack', 'a', '--wat'], ['install', 'a', '--home'], ['install', 'a', '--profile', '--yes'], ['pack', 'a', '--yes'], ['pack', 'a', '--dry-run', '--dry-run'], ['pack', 'a', '--profile=web']]) assert.throws(() => parseCli(argv));
});

test('shared runtime dependency and duplicate package identities are rejected', async t => {
  const root = await fixture(t);
  await pkg(root, 'shared'); await pkg(root, 'a', { dependencies: { 'dsh-next-shared': '*' } });
  await assert.rejects(planPackages(['a'], { root }), /build-only/);
  await pkg(root, 'b', { name: name('a') });
  await assert.rejects(discoverPackages(root), /Duplicate/);
});

test('media assets and wildcard exported declarations are inspected', async t => {
  const root = await fixture(t);
  await pkg(root, 'a', { exports: { '.': './lib/index.js', './types/*': './lib/types/*.d.ts' } });
  const plan = await planPackages(['a'], { root });
  const artifacts = await packPackages(plan, { run: packRunner([], files => ({ ...files, 'media/demo.webp': 'image', 'lib/types/public.d.ts': 'export {};' })) });
  assert.ok(artifacts[0].files.includes('media/demo.webp'));
  await assert.rejects(packPackages(plan, { run: packRunner([]) }), /Missing exported files/);
});

test('pack dry CLI and help work without commands or mutations', async t => {
  const root = await fixture(t); await pkg(root, 'a');
  const run = async () => assert.fail('must not run');
  assert.match((await runCli(['--help'], { root, run })).usage, /pack\|install/);
  assert.equal((await runCli(['pack', '--', 'a', '--dry-run'], { root, run })).dryRun, true);
  await assert.rejects(stat(join(root, 'artifacts')), { code: 'ENOENT' });
  await assert.rejects(runCli(['install', 'a', '--home', 'relative', '--yes'], { root, run }), /absolute non-root/);
});

test('configuration conflicts and missing reconciliation are partial failures with locks released', async t => {
  const { root, artifacts } = await artifactsFor(t), { home, dir } = await profile(root);
  for (const overrides of ['[]', 'invalid JSON', JSON.stringify({ ['parent>' + name('a')]: 'registry-version' })]) {
    await assert.rejects(installPackages(artifacts, { home, yes: true, run: installRunner([], { overrides }) }), error => {
      assert.equal(error.report.stage, 'configuring-overrides'); return true;
    });
    assert.ok(!(await readdir(join(home, 'profiles'))).some(file => file.includes('.lock')));
  }
  await assert.rejects(installPackages(artifacts, { home, yes: true, run: installRunner([], { omitBundle: true }) }), error => {
    assert.equal(error.report.stage, 'verifying-profile'); assert.match(error.message, /missing required local bundle/); return true;
  });
  assert.equal(await readFile(join(dir, 'node_modules/sentinel'), 'utf8'), 'sentinel');
});

test('fresh profile initialization is official, confirmed and contained', async t => {
  const { root, artifacts } = await artifactsFor(t), home = join(root, 'fresh home'), calls = [];
  const downstream = installRunner(calls, { overrides: '' });
  const run = async (command, args, options) => {
    if (args[0] === 'plugin' && args.at(-1) === '--version') {
      const dir = join(options.env.DSH_HOME, 'profiles', 'web');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['base'] } } }));
    }
    return downstream(command, args, options);
  };
  let asked = 0;
  await installPackages(artifacts, { home, run, isTTY: true, confirm: async () => { asked++; return true; } });
  assert.equal(asked, 1);
  assert.ok(calls.some(c => c.args[0] === 'plugin' && c.args.at(-1) === '--version'));
  assert.deepEqual(JSON.parse(await readFile(join(home, 'profiles/web/pnpm-workspace.yaml'))).overrides, { [name('a')]: 'file:' + artifacts[0].path });
});

test('successful full CLI builds and installs once with forwarded cancellation controls', async t => {
  const root = await fixture(t); await pkg(root, 'a');
  const { home } = await profile(root), calls = [], build = packRunner(calls), install = installRunner(calls);
  const signal = new AbortController().signal;
  const run = (command, args, options) => args[0] === 'run' || args[0] === 'pack' ? build(command, args, options) : install(command, args, options);
  const report = await runCli(['install', 'a', '--home', home, '--yes'], { root, run, signal, timeoutMs: 54321 });
  assert.equal(report.stage, 'complete');
  assert.ok(calls.every(c => c.signal === signal && c.timeoutMs === 54321));
});

test('missing pack output is an error; already packed artifacts survive a later failure', async t => {
  const root = await fixture(t); await pkg(root, 'a'); await pkg(root, 'b');
  const plan = await planPackages(['a', 'b'], { root });
  const run = packRunner([]);
  await assert.rejects(packPackages(plan, { run: async (command, args, options) => {
    if (args[0] === 'pack' && basename(options.cwd) === 'dsh-next-b') return ok();
    return run(command, args, options);
  } }), error => { assert.equal(error.artifacts.length, 1); assert.match(error.message, /Expected one tarball/); return true; });
  assert.equal((await readdir(join(root, 'artifacts/packages'))).length, 1);
});


test('selected bundles normalize topologically while all unrelated slots and metadata survive', async t => {
  const root = await fixture(t);
  await pkg(root, 'z'); await pkg(root, 'a', { peerDependencies: { [name('z')]: '^1' } });
  const artifacts = await packPackages(await planPackages(['a'], { root }), { run: packRunner([]) });
  const { home, dir } = await profile(root), calls = [], downstream = installRunner(calls);
  let before;
  const run = async (command, args, options) => {
    const result = await downstream(command, args, options);
    if (args.includes('add')) {
      const path = join(dir, 'package.json');
      before = JSON.parse(await readFile(path));
      before.dsh.profile.bundles = ['unrelated', name('a'), 'middle-unrelated', name('z'), 'last-unrelated'];
      before.custom = { deep: ['sentinel', 99] };
      await writeFile(path, JSON.stringify(before));
    }
    return result;
  };
  const report = await installPackages(artifacts, { home, run, yes: true });
  assert.deepEqual(report.bundles, [name('z'), name('a')]);
  const after = JSON.parse(await readFile(join(dir, 'package.json')));
  assert.deepEqual(after.dsh.profile.bundles, ['unrelated', name('z'), 'middle-unrelated', name('a'), 'last-unrelated']);
  before.dsh.profile.bundles = after.dsh.profile.bundles;
  assert.deepEqual(after, before);
  assert.ok(!(await readdir(dir)).some(file => file.startsWith('.workflow-metadata-')));
});

test('already-topological profile metadata is not rewritten by order verification', async t => {
  const { root, artifacts } = await artifactsFor(t), { home, dir } = await profile(root);
  const downstream = installRunner([]), path = join(dir, 'package.json');
  let snapshot, inode;
  const run = async (command, args, options) => {
    const result = await downstream(command, args, options);
    if (args.includes('add')) { snapshot = await readFile(path); inode = (await stat(path)).ino; }
    return result;
  };
  await installPackages(artifacts, { home, run, yes: true });
  assert.deepEqual(await readFile(path), snapshot);
  assert.equal((await stat(path)).ino, inode);
});


test('independently selected optional local peers become validated dependency-first edges', async t => {
  const root = await fixture(t);
  await pkg(root, 'b');
  await pkg(root, 'a', { peerDependencies: { [name('b')]: '^1' }, peerDependenciesMeta: { [name('b')]: { optional: true } } });
  assert.deepEqual(names((await planPackages(['a'], { root })).packages), [name('a')]);
  assert.deepEqual(names((await planPackages(['a', 'b'], { root })).packages), [name('b'), name('a')]);
  await pkg(root, 'a', { optionalDependencies: { [name('b')]: '^2' } });
  assert.deepEqual(names((await planPackages(['a'], { root })).packages), [name('a')]);
  await assert.rejects(planPackages(['a', 'b'], { root }), /version mismatch/);
});


for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) test('direct CLI awaits fake build cleanup on ' + signal, { timeout: 10000 }, async t => {
  const root = await fixture(t);
  await pkg(root, 'a');
  await mkdir(join(root, 'scripts'));
  await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'));
  await writeFile(join(root, 'scripts/workflow-pack.mjs'), await readFile(fileURLToPath(new URL('./workflow-pack.mjs', import.meta.url))));
  await writeFile(join(root, 'scripts/workflow-runtime.mjs'), [
    "import { writeFile } from 'node:fs/promises';",
    'export const withoutModelCredentials = env => env;',
    'export async function runCommand(command, args, { signal, cwd }) {',
    '  let timer;',
    '  try { await new Promise((resolve, reject) => {',
    '    timer = setInterval(() => {}, 1000);',
    "    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });",
    "    process.stdout.write('fake-build-ready\\n');",
    '  }); } finally { clearInterval(timer); await writeFile(cwd + "/cleaned", "yes"); }',
    '}',
  ].join('\n'));
  const child = spawn(process.execPath, [join(root, 'scripts/workflow-pack.mjs'), 'pack', 'a'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let output = '', errors = '', sent = false;
  child.stdout.on('data', chunk => {
    output += chunk;
    if (output.includes('fake-build-ready') && !sent) { sent = true; child.kill(signal); }
  });
  child.stderr.on('data', chunk => { errors += chunk; });
  const outcome = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  assert.equal(outcome.code, exitCode, errors);
  assert.equal(outcome.signal, null);
  assert.equal(await readFile(join(root, 'packages/dsh-next-a/cleaned'), 'utf8'), 'yes');
  await assert.rejects(stat(join(root, 'artifacts')), { code: 'ENOENT' });
});


test('install interruption reports partial state and releases profile lock', async t => {
  const { root, artifacts } = await artifactsFor(t), { home, dir } = await profile(root);
  const controller = new AbortController(), downstream = installRunner([]);
  const run = async (command, args, options) => {
    if (args.includes('add')) {
      controller.abort();
      options.signal.throwIfAborted();
    }
    return downstream(command, args, options);
  };
  await assert.rejects(installPackages(artifacts, { home, run, yes: true, signal: controller.signal }), error => {
    assert.equal(error.report.partial, true);
    assert.equal(error.report.stage, 'installing');
    return true;
  });
  assert.equal(await readFile(join(dir, 'node_modules/sentinel'), 'utf8'), 'sentinel');
  assert.ok(!(await readdir(join(home, 'profiles'))).some(file => file.includes('.lock')));
});
