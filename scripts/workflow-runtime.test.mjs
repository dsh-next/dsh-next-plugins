import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScratch, credentialEnvironment, redact, resolveCredentials, runCommand, startDsh, withoutModelCredentials, isolatedGitEnvironment } from './workflow-runtime.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const synthetic = 'sk-synthetic-not-a-real-credential';

test('raw command output is private and does not corrupt machine-readable credentials', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({unrelated:process.env.NPM_TOKEN}))'], {
    env: { ...withoutModelCredentials(process.env), NPM_TOKEN: synthetic }, captureRawStdout: true,
  });
  assert.equal(JSON.parse(result.rawStdout).unrelated, synthetic);
  assert.equal(JSON.parse(result.stdout).unrelated, '[REDACTED]');
  assert.equal(JSON.stringify(result).includes(synthetic), false);
});

test('fixture Git environment removes external routing and disables global hooks/config', () => {
  const original = { PATH: '/bin', GIT_DIR: '/external/.git', GIT_WORK_TREE: '/external', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.hooksPath', GIT_CONFIG_VALUE_0: '/external/hooks' };
  const result = isolatedGitEnvironment(original);
  assert.equal(result.GIT_DIR, undefined);
  assert.equal(result.GIT_WORK_TREE, undefined);
  assert.equal(result.GIT_CONFIG_COUNT, undefined);
  assert.equal(result.GIT_CONFIG_NOSYSTEM, '1');
  assert.ok(result.GIT_CONFIG_GLOBAL);
  assert.equal(result.PATH, '/bin');
  assert.equal(original.GIT_DIR, '/external/.git');
});

test('keyless ignores inherited keys and files; copied build env strips providers', async () => {
  const env = { PATH: '/bin', NPM_TOKEN: 'registry', DEEPSEEK_API_KEY: synthetic, OPENAI_API_KEY: 'open', ANTHROPIC_AUTH_TOKEN: 'anth', AWS_SECRET_ACCESS_KEY: 'aws', GOOGLE_APPLICATION_CREDENTIALS: 'file', HF_TOKEN: 'hub', AZURE_API_KEY: 'azure', REPLICATE_API_TOKEN: 'replicate' };
  const result = await resolveCredentials({ env, envFile: '/not/read' });
  assert.equal(result.source, 'keyless');
  assert.deepEqual(result.env, { PATH: '/bin', NPM_TOKEN: 'registry', DEEPSEEK_API_KEY: 'fake-e2e-key' });
  assert.deepEqual(withoutModelCredentials(env), { PATH: '/bin', NPM_TOKEN: 'registry' });
  assert.equal(env.DEEPSEEK_API_KEY, synthetic);
  assert.equal(credentialEnvironment(result, env).DEEPSEEK_API_KEY, 'fake-e2e-key');
});

test('live credential precedence, quoted dotenv data and CI selection', async t => {
  const root = await fixture(t);
  const explicit = join(root, 'explicit.env');
  const fallback = join(root, '.config/dsh-next/testing.env');
  await mkdir(join(root, '.config/dsh-next'), { recursive: true });
  await writeFile(explicit, '# comment\nexport DEEPSEEK_API_KEY="' + synthetic + '" # comment\nOPENAI_API_KEY=ignored\nINERT=$(touch never)\n');
  await writeFile(fallback, "DEEPSEEK_API_KEY='approved-synthetic'\n");
  const inherited = await resolveCredentials({ live: true, env: { DEEPSEEK_API_KEY: synthetic }, envFile: '/not/read' });
  assert.equal(inherited.source, 'environment');
  assert.equal(Object.keys(inherited).includes('apiKey'), false);
  assert.doesNotMatch(JSON.stringify(inherited), /sk-synthetic/);
  assert.equal((await resolveCredentials({ live: true, env: { CI: '1', DSH_TEST_ENV_FILE: explicit } })).apiKey, synthetic);
  assert.equal((await resolveCredentials({ live: true, env: { DSH_TEST_ENV_FILE: '/not/read' }, envFile: explicit })).apiKey, synthetic);
  assert.equal((await resolveCredentials({ live: true, env: {}, homeDir: root })).source, 'approved-file');
  await assert.rejects(resolveCredentials({ live: true, env: { CI: '1' }, homeDir: root }), /explicitly select/);
  await assert.rejects(resolveCredentials({ live: true, env: {}, envFile: '/not/read' }), /Cannot read/);
});

test('invalid keys and malformed files fail sanitized preflight', async t => {
  for (const value of ['', '  ', 'fake-e2e-key', 'your-api-key', 'sk-test', 'sk-test-something', 'dev-placeholder-key', 'dummy', 'hello world']) {
    await assert.rejects(resolveCredentials({ live: true, env: { DEEPSEEK_API_KEY: value } }), /placeholder/);
  }
  const root = await fixture(t);
  const file = join(root, 'key.env');
  for (const text of ['DEEPSEEK_API_KEY="unterminated', 'source ~/.zshrc', 'bad line', 'DEEPSEEK_API_KEY="key" junk']) {
    await writeFile(file, text);
    await assert.rejects(resolveCredentials({ live: true, env: {}, envFile: file }), /malformed/);
  }
  await writeFile(file, 'OTHER=value');
  await assert.rejects(resolveCredentials({ live: true, env: {}, envFile: file }), /placeholder/);
});

test('scratch is private, unique, isolated and only deletes its child', async t => {
  const parent = await fixture(t);
  await writeFile(join(parent, 'keep'), 'sentinel');
  const a = await createScratch({ parent });
  const b = await createScratch({ parent });
  assert.notEqual(a.root, b.root);
  for (const path of [a.root, a.home, a.agentsHome, a.workspaceA, a.workspaceB]) assert.equal((await stat(path)).mode & 0o777, 0o700);
  assert.deepEqual(a.env, { DSH_HOME: a.home, DSH_AGENTS_HOME: a.agentsHome });
  await symlink(parent, join(a.root, 'external'));
  await a.dispose(); await a.dispose();
  assert.equal(await readFile(join(parent, 'keep'), 'utf8'), 'sentinel');
  await stat(b.root); await b.dispose();
  await assert.rejects(createScratch({ parent, prefix: '../escape-' }), /prefix/);
  await symlink(parent, join(parent, 'link'));
  const aliased = await createScratch({ parent: join(parent, 'link') });
  assert.equal(aliased.root.startsWith(await realpath(parent) + '/dsh-next-'), true);
  await aliased.dispose();
  assert.equal(await readFile(join(parent, 'keep'), 'utf8'), 'sentinel');
});

test('scratch disposal rejects root and ancestor replacement symlinks', async t => {
  const parent = await fixture(t);
  const scratch = await createScratch({ parent });
  await rename(scratch.root, scratch.root + '-moved');
  await symlink(parent, scratch.root);
  await assert.rejects(scratch.dispose(), /replaced/);
  const outer = join(parent, 'outer'); await mkdir(outer);
  const nested = await createScratch({ parent: outer });
  await rename(outer, outer + '-moved'); await symlink(outer + '-moved', outer);
  await assert.rejects(nested.dispose(), /replaced/);
});

test('redaction removes encoded secrets, URL tokens and authorization', () => {
  assert.equal(redact('a secret/a secret%2Fa', ['secret/a']), 'a [REDACTED] [REDACTED]');
  const result = redact('http://localhost:1/?token=synthetic-token Authorization: Bearer synthetic-auth DEEPSEEK_API_KEY=synthetic-key');
  assert.doesNotMatch(result, /synthetic-/);
  const structured = { api_key: 'synthetic-value', authorization: 'Bearer synthetic-auth', access_token: 'synthetic-token', token: 'synthetic-generated', DEEPSEEK_API_KEY: 'synthetic-quoted-\"-key' };
  const clean = redact(JSON.stringify(structured));
  assert.doesNotMatch(clean, /synthetic-/);
  assert.deepEqual(JSON.parse(clean), Object.fromEntries(Object.keys(structured).map(key => [key, '[REDACTED]'])));
  assert.equal(redact("'api-key': 'synthetic with spaces'"), "'api-key': '[REDACTED]'");
  assert.equal(redact('Bearer synthetic-unlabeled'), 'Bearer [REDACTED]');
});

test('runCommand preserves structured args and sanitizes success/failure output', async () => {
  const env = { ...withoutModelCredentials(), DEEPSEEK_API_KEY: synthetic };
  const success = await runCommand(process.execPath, ['-e', 'console.log(process.argv[1]); console.log(process.env.DEEPSEEK_API_KEY)', 'hello ; $(inert)'], { env, killTimeoutMs: 10 });
  assert.match(success.stdout, /hello ; \$\(inert\)/);
  assert.doesNotMatch(success.stdout, /sk-synthetic/);
  await assert.rejects(runCommand(process.execPath, ['-e', 'console.error(process.env.DEEPSEEK_API_KEY); process.exit(2)'], { env, killTimeoutMs: 10 }), error => /Command failed/.test(error.message) && !error.message.includes(synthetic));
  await assert.rejects(runCommand('/nonexistent/runtime-command', [], { killTimeoutMs: 10 }), /Command failed/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(runCommand(process.execPath, [], { signal: controller.signal }), /aborted/);
});

async function fake(t, source) {
  const root = await fixture(t);
  const script = join(root, 'fake.mjs'); await writeFile(script, source);
  return { dsh: process.execPath, args: [script], home: root, agentsHome: join(root, 'agents'), profile: 'test', artifactDir: join(root, 'artifacts'), env: { ...withoutModelCredentials(), DEEPSEEK_API_KEY: synthetic }, timeoutMs: 2000, killTimeoutMs: 60 };
}
const server = "import http from 'node:http'; const token='synthetic-boot-token'; " +
  "process.on('SIGTERM',()=>{}); const s=http.createServer((req,res)=>{ if(req.url!=='/?token='+token){res.writeHead(401);res.end();return;} res.writeHead(303,{'set-cookie':'session=synthetic-cookie','location':'/'});res.end(); }); " +
  "s.listen(0,'127.0.0.1',()=>{console.log(process.env.DEEPSEEK_API_KEY);console.log('http://127.0.0.1:'+s.address().port+'/?token='+token);});";

test('startDsh authenticates readiness, keeps URL private and kills TERM-resistant child', async t => {
  const options = await fake(t, server);
  const runtime = await startDsh(options); t.after(runtime.dispose);
  assert.match(runtime.url, /token=synthetic-boot-token/);
  assert.doesNotMatch(JSON.stringify(runtime), /synthetic-boot-token/);
  assert.match(runtime.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  await runtime.dispose(); await runtime.dispose();
  assert.throws(() => process.kill(runtime.pid, 0), { code: 'ESRCH' });
  assert.equal((await runtime.exited).signal, 'SIGKILL');
  const log = await readFile(runtime.logPath, 'utf8');
  assert.doesNotMatch(log, /synthetic-(?:boot-token|not-a-real)/);
  assert.equal((await stat(runtime.logPath)).mode & 0o777, 0o600);
});

test('early exit and readiness timeout are bounded and sanitized', async t => {
  const options = await fake(t, "console.log(process.env.DEEPSEEK_API_KEY); console.log('http://127.0.0.1:1/?token=synthetic-early'); process.exit(3)");
  await assert.rejects(startDsh(options), error => /exited before readiness/.test(error.message) && !/synthetic-/.test(error.message));
  const timeout = await fake(t, "import fs from 'node:fs'; fs.writeFileSync(process.env.DSH_HOME+'/pid',String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);");
  await assert.rejects(startDsh({ ...timeout, timeoutMs: 300 }), /timed out/);
  const pid = Number(await readFile(join(timeout.home, 'pid'), 'utf8'));
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('startup rejects missing parameters, spawn failures and pre-aborted signals', async t => {
  await assert.rejects(startDsh(), /home and profile/);
  const options = await fake(t, server);
  await assert.rejects(startDsh({ ...options, dsh: '/nonexistent/fake-dsh' }), /exited before readiness/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(startDsh({ ...options, signal: controller.signal }), /aborted/);
  await assert.rejects(runCommand('bad\0command', []), /Cannot launch/);
});

test('unauthenticated redirects do not count as readiness', async t => {
  const options = await fake(t, "import http from 'node:http'; const s=http.createServer((req,res)=>{res.writeHead(303,{location:'/login'});res.end()});s.listen(0,'127.0.0.1',()=>console.log('http://127.0.0.1:'+s.address().port+'/?token=synthetic-rejected'));");
  await assert.rejects(startDsh({ ...options, timeoutMs: 250 }), /timed out/);
});

test('process group cleanup kills a TERM-resistant descendant after leader exits', { skip: process.platform === 'win32' }, async t => {
  const root = await fixture(t);
  const pidFile = join(root, 'descendant-pid');
  const descendant = "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)";
  const leader = "const {spawn}=require('node:child_process');const fs=require('node:fs');spawn(process.execPath,['-e',process.argv[1],process.argv[2]],{stdio:'ignore'});const timer=setInterval(()=>{if(fs.existsSync(process.argv[2])){clearInterval(timer);process.exit(0)}},10)";
  await runCommand(process.execPath, ['-e', leader, descendant, pidFile], { killTimeoutMs: 80 });
  const pid = Number(await readFile(pidFile, 'utf8'));
  // The OS may need a moment to reap the orphan after group SIGKILL.
  for (let attempt = 0; attempt < 20; attempt++) {
    try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); return; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.fail('Owned descendant survived process group teardown');
});

test('ready DSH automatically disposes descendants at leader exit, and late disposal never signals again', { skip: process.platform === 'win32' }, async t => {
  const descendant = "process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)";
  const source = "import http from 'node:http';import fs from 'node:fs';import {spawn} from 'node:child_process';" +
    "const file=process.env.DSH_HOME+'/descendant-pid';spawn(process.execPath,['-e'," + JSON.stringify(descendant) + ",file],{stdio:'ignore'});" +
    "const s=http.createServer((req,res)=>{res.end('ready');if(req.url==='/exit')setImmediate(()=>process.exit(7))});" +
    "s.listen(0,'127.0.0.1',()=>{const timer=setInterval(()=>{if(fs.existsSync(file)){clearInterval(timer);console.log('http://127.0.0.1:'+s.address().port+'/?token=synthetic-auto-exit')}},10)});";
  const options = await fake(t, source);
  const runtime = await startDsh(options); t.after(runtime.dispose);
  const pid = Number(await readFile(join(options.home, 'descendant-pid'), 'utf8'));
  await (await fetch(runtime.origin + '/exit')).text();
  assert.equal((await runtime.exited).code, 7);
  let gone = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { process.kill(pid, 0); } catch (error) { assert.equal(error.code, 'ESRCH'); gone = true; break; }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(gone, true, 'Descendant must terminate without caller disposal');
  const kill = t.mock.method(process, 'kill');
  await runtime.dispose(); await runtime.dispose();
  assert.equal(kill.mock.callCount(), 0, 'Late disposal must reuse initial teardown');
  kill.mock.restore();
  assert.doesNotMatch(await readFile(runtime.logPath, 'utf8'), /synthetic-auto-exit/);
});

test('AbortSignal stops ready runtime and in-flight commands without global listeners', async t => {
  const before = process.listenerCount('SIGTERM');
  const options = await fake(t, server);
  const controller = new AbortController();
  const runtime = await startDsh({ ...options, signal: controller.signal });
  controller.abort(); await runtime.dispose();
  assert.throws(() => process.kill(runtime.pid, 0), { code: 'ESRCH' });
  const cancel = new AbortController();
  const task = runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: cancel.signal, killTimeoutMs: 10 });
  cancel.abort(); await assert.rejects(task, /aborted/);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000)'], { timeoutMs: 150, killTimeoutMs: 20 }), /timed out/);
  assert.equal(process.listenerCount('SIGTERM'), before);
});
