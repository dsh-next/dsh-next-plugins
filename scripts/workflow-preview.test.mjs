import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePreviewOptions, runPreview } from './workflow-preview.mjs';
import { createScratch, runCommand } from './workflow-runtime.mjs';
import { seedRuntime } from './workflow-fixtures.mjs';
import { repositoryRoot } from './workflow-pack.mjs';

const token = 'synthetic-preview-token';
const inherited = 'synthetic-inherited-key';
async function setup(t, mode, hooks = {}) {
  const parent = await mkdtemp(join(tmpdir(), 'preview-test-'));
  t.after(() => rm(parent, { recursive: true, force: true }));
  await writeFile(join(parent, 'sentinel'), 'untouched');
  const controller = new AbortController();
  const calls = [], logs = [];
  let owned, resolveExit;
  const exited = new Promise(resolve => { resolveExit = resolve; });
  const deps = {
    env: { PATH: process.env.PATH, DEEPSEEK_API_KEY: inherited, OPENAI_API_KEY: 'synthetic-openai', DSH_TEST_ENV_FILE: '/must-not-read', DSH_HOME: '/must-not-touch', DSH_AGENTS_HOME: '/must-not-touch-agents', GIT_DIR: '/must-not-touch-git', GIT_WORK_TREE: '/must-not-touch-worktree', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/must-not-run' }, signal: controller.signal,
    log(line) { logs.push(line); if (mode === 'skills' && line.startsWith('Owned scratch:')) queueMicrotask(() => controller.abort()); },
    async planPackages(selectors) { calls.push(['plan', selectors]); return { packages: [{ name: 'local-required' }], buildPackages: [] }; },
    async createScratch(options) { owned = await createScratch(options); calls.push(['scratch', owned.root]); return { ...owned, async dispose() { calls.push(['scratch.dispose']); await owned.dispose(); } }; },
    async seedRuntime(scratch, options) { calls.push(['seed', options]); await seedRuntime(scratch, options); },
    async packPackages(plan, options) { calls.push(['pack', options]); return ['immutable-local-closure']; },
    async installPackages(artifacts, options) { calls.push(['install', options]); assert.deepEqual(artifacts, ['immutable-local-closure']); },
    async startDsh(options) { calls.push(['start', options]); return { origin: 'http://127.0.0.1:1234', url: 'http://127.0.0.1:1234/?token=' + token, exited, async dispose() { calls.push(['runtime.dispose']); resolveExit({ code: 0 }); } }; },
    async run(command, args, options) { calls.push(['run', command, args, options]); return { code: 0, stdout: command === process.execPath ? 'capture ' + token : '', stderr: '' }; },
    ...hooks,
  };
  const options = parsePreviewOptions([mode, '--scratch-base', parent], {});
  return { parent, controller, calls, logs, deps, options, get owned() { return owned; }, resolveExit };
}

test('preview options retain safe legacy aliases and reject unsafe semantics', () => {
  const env = { SKILLS_E2E_HOME: '/parent', SKILLS_E2E_PORT: '0', DSH_CMD: '/dsh path', KEEP_HOME: '1' };
  const options = parsePreviewOptions(['skills'], env);
  assert.equal(options.parent, '/parent'); assert.equal(options.keep, true); assert.equal(options.dsh, '/dsh path');
  assert.equal(parsePreviewOptions(['skills', '--', '--scratch-base', '/selected'], env).parent, '/selected');
  assert.equal(parsePreviewOptions(['worktrees', '--out', '/out'], { OUT: '/old' }).out, '/out');
  assert.equal(parsePreviewOptions(['worktrees'], { KEEP_HOME: '0' }).keep, false);
  for (const argv of [[], ['other'], ['skills', 'extra'], ['skills', '--live'], ['skills', '--out', '/out'], ['skills', '--port', '1']]) assert.throws(() => parsePreviewOptions(argv, {}));
  assert.throws(() => parsePreviewOptions(['skills'], { SKILLS_E2E_OVERWRITE: '1' }), /retired/);
  assert.throws(() => parsePreviewOptions(['skills'], { SKILLS_E2E_PORT: '9876' }), /OS-assigned/);
  assert.throws(() => parsePreviewOptions(['worktrees'], { PORT: '9876' }), /OS-assigned/);
  assert.equal(parsePreviewOptions(['skills', '--help'], { SKILLS_E2E_OVERWRITE: '1' }).help, true);
});

test('skills uses shared closure packaging, private URL and preserved fixture cases', async t => {
  const state = await setup(t, 'skills');
  state.options.keep = true;
  const result = await runPreview(state.options, state.deps);
  const settings = JSON.parse(await readFile(join(state.owned.home, 'settings.yaml'), 'utf8'));
  assert.deepEqual(settings['dsh-next-skills'].installations.map(item => item.name), ['e2e-test-skill', 'grill-me', 'opentofu']);
  assert.deepEqual(settings['dsh-next-skills'].scopes.opentofu, []);
  for (const name of ['e2e-test-skill', 'grill-me', 'opentofu', 'hand-made']) await stat(join(state.owned.agentsHome, 'skills', name, 'SKILL.md'));
  assert.match(await readFile(join(state.owned.agentsHome, 'skills/opentofu/SKILL.md'), 'utf8'), /disable-model-invocation: true/);
  assert.equal((await stat(result.urlFile)).mode & 0o777, 0o600);
  assert.match(await readFile(result.urlFile, 'utf8'), /synthetic-preview-token/);
  assert.doesNotMatch(state.logs.join('\n'), /synthetic-/);
  assert.deepEqual(state.calls[0], ['plan', ['skills']]);
  const boot = state.calls.find(([name]) => name === 'start')[1];
  assert.equal(boot.port, 0); assert.equal(boot.env.DEEPSEEK_API_KEY, 'fake-e2e-key');
  assert.equal(boot.env.OPENAI_API_KEY, undefined); assert.equal(boot.env.DSH_AGENTS_HOME, state.owned.agentsHome);
  for (const name of ['pack', 'install']) {
    const options = state.calls.find(([entry]) => entry === name)[1];
    assert.equal(options.env.DEEPSEEK_API_KEY, undefined); assert.equal(options.env.DSH_HOME, state.owned.home);
    assert.equal(options.env.DSH_AGENTS_HOME, state.owned.agentsHome);
  }
  assert.equal(state.calls.filter(([name]) => name === 'runtime.dispose').length, 1);
  assert.equal(state.calls.some(([name]) => name === 'scratch.dispose'), false);
  assert.equal(await readFile(join(state.parent, 'sentinel'), 'utf8'), 'untouched');
});

test('worktrees preserves harbor dark-theme capture and cleans owned run', async t => {
  const state = await setup(t, 'worktrees');
  let settings, harborReadme;
  const oldRun = state.deps.run;
  state.deps.run = async (command, args, options) => {
    if (command === process.execPath) {
      settings = JSON.parse(await readFile(join(options.env.DSH_HOME, 'settings.yaml'), 'utf8'));
      harborReadme = await readFile(join(options.env.DSH_README_WORKSPACE, 'README.md'), 'utf8');
      assert.equal(options.env.DEEPSEEK_API_KEY, 'fake-e2e-key');
      for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) assert.equal(options.env[key], undefined);
      assert.equal(options.env.GIT_CONFIG_GLOBAL, '/dev/null');
      assert.equal(options.env.DSH_README_WORKSPACE, join(state.owned.root, 'harbor'));
      assert.deepEqual(args, [join(repositoryRoot, 'scripts/capture-worktrees-readme.mjs')]);
      assert.equal(options.env.DSH_README_OUT, state.options.out);
    }
    return oldRun(command, args, options);
  };
  await runPreview(state.options, state.deps);
  assert.equal(settings['ui-theme'].preference, 'dark'); assert.equal(settings.locale.preference, 'en');
  assert.match(harborReadme, /Checkout and cart API/);
  assert.equal(state.calls.filter(([name, command]) => name === 'run' && command === 'git').length, 7);
  assert.deepEqual(state.calls.slice(-2).map(([name]) => name), ['runtime.dispose', 'scratch.dispose']);
  await assert.rejects(stat(state.owned.root), { code: 'ENOENT' });
  assert.equal(await readFile(join(state.parent, 'sentinel'), 'utf8'), 'untouched');
  assert.doesNotMatch(state.logs.join('\n'), /synthetic-/);
});

test('failure at pack, install, boot or capture cleans owned scratch and redacts secrets', async t => {
  for (const stage of ['packPackages', 'installPackages', 'startDsh', 'capture']) {
    const state = await setup(t, 'worktrees');
    const fail = async () => { throw new Error('failure ' + inherited + ' ?token=' + token); };
    if (stage === 'capture') state.deps.run = async command => command === process.execPath ? fail() : { code: 0, stdout: '', stderr: '' };
    else state.deps[stage] = fail;
    await assert.rejects(runPreview(state.options, state.deps), error => /failure/.test(error.message) && !/synthetic-/.test(error.message));
    await assert.rejects(stat(state.owned.root), { code: 'ENOENT' });
    assert.equal(await readFile(join(state.parent, 'sentinel'), 'utf8'), 'untouched');
    assert.equal(state.calls.some(([name]) => name === 'runtime.dispose'), stage === 'capture');
  }
});

test('unexpected skills exit aborts and cleans; pre-abort does no work', async t => {
  const state = await setup(t, 'skills', { log() {} });
  const boot = state.deps.startDsh;
  state.deps.startDsh = async options => { const runtime = await boot(options); queueMicrotask(() => state.resolveExit({ code: 9 })); return runtime; };
  await assert.rejects(runPreview(state.options, state.deps), /unexpectedly/);
  await assert.rejects(stat(state.owned.root), { code: 'ENOENT' });
  state.controller.abort();
  const before = state.calls.length;
  await assert.rejects(runPreview(state.options, state.deps), /aborted/);
  assert.equal(state.calls.length, before);
});

test('server exit cancels capture and dispose failures still remove scratch', async t => {
  const state = await setup(t, 'worktrees');
  const oldRun = state.deps.run;
  state.deps.run = async (command, args, options) => {
    if (command !== process.execPath) return oldRun(command, args, options);
    const stopped = new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true }));
    state.resolveExit({ code: 8 });
    await stopped;
    throw new Error('Capture aborted after server exit');
  };
  await assert.rejects(runPreview(state.options, state.deps), /Capture aborted/);
  await assert.rejects(stat(state.owned.root), { code: 'ENOENT' });
  const cleanup = await setup(t, 'worktrees');
  const boot = cleanup.deps.startDsh;
  cleanup.deps.startDsh = async options => ({ ...await boot(options), async dispose() { throw new Error('Synthetic disposal failure'); } });
  await assert.rejects(runPreview(cleanup.options, cleanup.deps), /disposal failure/);
  await assert.rejects(stat(cleanup.owned.root), { code: 'ENOENT' });
});

test('explicit retention survives failures without touching parent', async t => {
  const state = await setup(t, 'worktrees', { async packPackages() { throw new Error('Synthetic pack failure'); } });
  state.options.keep = true;
  await assert.rejects(runPreview(state.options, state.deps), /pack failure/);
  await stat(state.owned.root);
  assert.match(state.logs.join('\n'), /Retained owned scratch:/);
  assert.equal(await readFile(join(state.parent, 'sentinel'), 'utf8'), 'untouched');
});

test('shell aliases forward help from outside repository without launching DSH', async () => {
  for (const name of ['skills-e2e-boot.sh', 'capture-worktrees-readme.sh']) {
    const result = await runCommand('bash', [join(repositoryRoot, 'scripts', name), '--help'], { cwd: tmpdir() });
    assert.match(result.stdout, /Always keyless/);
  }
});
