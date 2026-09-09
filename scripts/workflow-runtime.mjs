import { spawn } from 'node:child_process';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir, devNull } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const modelCredential = /^(?:(?:DEEPSEEK|OPENAI|ANTHROPIC|GEMINI|GOOGLE|GROQ|MISTRAL|COHERE|OPENROUTER|XAI|TOGETHER|FIREWORKS|PERPLEXITY|CEREBRAS|AZURE|AWS|BEDROCK|VERTEX|OLLAMA|HF|HUGGINGFACE|REPLICATE|SILICONFLOW|DASHSCOPE|QWEN|ZHIPU|MOONSHOT|MINIMAX|KIMI|NVIDIA|AI_GATEWAY|DSH)[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|ACCESS_KEY|CREDENTIALS)[A-Z0-9_]*|GOOGLE_APPLICATION_CREDENTIALS)$/i;
export function withoutModelCredentials(env = process.env) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !modelCredential.test(key)));
}

/** Fixture Git commands must not inherit routing, templates, hooks or global config. */
export function isolatedGitEnvironment(env = process.env) {
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_'))), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull };
}

export function credentialEnvironment(credentials, env = process.env) {
  return { ...withoutModelCredentials(env), DEEPSEEK_API_KEY: credentials.live ? credentials.apiKey : 'fake-e2e-key' };
}

function validKey(value) {
  return typeof value === 'string' && value.trim() && !/\s/.test(value) && !/^(?:fake(?:[-_].*)?|dummy(?:[-_].*)?|test(?:[-_].*)?|(?:dev[-_])?placeholder(?:[-_].*)?|changeme|your[-_].*|sk[-_](?:fake|test|dummy|placeholder|your)(?:[-_].*)?|xxx+|none|null|undefined)$/i.test(value);
}

// Strict dotenv data grammar; parseEnv is deliberately permissive about malformed lines.
function parseCredentialFile(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  for (const line of lines) {
    if (!/^\s*(?:#.*)?$/.test(line) && !/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:"[^"\r\n]*"\s*(?:#.*)?|'[^'\r\n]*'\s*(?:#.*)?|[^'"\r\n]*)$/.test(line)) {
      throw new Error('Credential env file is malformed');
    }
  }
  return parseEnv(text).DEEPSEEK_API_KEY;
}

export async function resolveCredentials({ live = false, env = process.env, envFile, homeDir = homedir() } = {}) {
  let apiKey = 'fake-e2e-key';
  let source = 'keyless';
  if (live) {
    if (Object.hasOwn(env, 'DEEPSEEK_API_KEY') && env.DEEPSEEK_API_KEY !== undefined) {
      apiKey = env.DEEPSEEK_API_KEY;
      source = 'environment';
    } else {
      const selected = envFile ?? env.DSH_TEST_ENV_FILE;
      const file = selected ?? (env.CI ? undefined : join(homeDir, '.config/dsh-next/testing.env'));
      if (!file) throw new Error('Live credentials required: set DEEPSEEK_API_KEY or explicitly select a testing env file');
      let text;
      try { text = await readFile(file, 'utf8'); } catch { throw new Error('Cannot read live credential env file'); }
      apiKey = parseCredentialFile(text);
      source = selected === undefined ? 'approved-file' : 'explicit-file';
    }
    if (!validKey(apiKey)) throw new Error('Live DEEPSEEK_API_KEY is missing, empty, or a placeholder');
  }
  const result = { live, source };
  Object.defineProperty(result, 'apiKey', { value: apiKey });
  Object.defineProperty(result, 'env', { value: credentialEnvironment(result, env) });
  return result;
}

export function redact(text, secrets = []) {
  let result = String(text);
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.split(String(secret)).join('[REDACTED]');
    result = result.split(encodeURIComponent(String(secret))).join('[REDACTED]');
  }
  return result.replace(/([?&](?:token|api_key|key|access_token)=)[^\s&#"'<>]*/gi, '$1[REDACTED]')
    .replace(/((?:["']?)(?:api[_-]?key|authorization|access[_-]?token|DEEPSEEK_API_KEY|token)["']?\s*[=:]\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(?:Bearer\s+)?[^\s,"'}]+)/gi, (_match, prefix, value) => {
      const quote = /^["']/.test(value) ? value[0] : '';
      return prefix + quote + '[REDACTED]' + quote;
    })
    .replace(/\bBearer\s+[^\s,"'}]+/gi, 'Bearer [REDACTED]');
}

export async function createScratch({ parent = tmpdir(), prefix = 'dsh-next-' } = {}) {
  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) throw new Error('Invalid scratch prefix');
  const base = await realpath(parent);
  // Canonicalize caller-owned parents (including /tmp aliases); own only the child.
  const root = await mkdtemp(join(base, prefix));
  await chmod(root, 0o700);
  const identity = await lstat(root);
  const home = join(root, 'home');
  const agentsHome = join(root, 'agents');
  const workspaceA = join(root, 'workspace-a');
  const workspaceB = join(root, 'workspace-b');
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    let current;
    try { current = await lstat(root); } catch (error) { if (error.code === 'ENOENT') { disposed = true; return; } throw error; }
    if (current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino || await realpath(root) !== root) {
      throw new Error('Refusing to remove replaced scratch directory');
    }
    await rm(root, { recursive: true, force: true });
    disposed = true;
  };
  try {
    await Promise.all([home, agentsHome, workspaceA, workspaceB].map(path => mkdir(path, { mode: 0o700 })));
  } catch (error) { await dispose(); throw error; }
  return { root, home, agentsHome, workspaceA, workspaceB, env: { DSH_HOME: home, DSH_AGENTS_HOME: agentsHome }, dispose };
}

function launch(executable, args, { cwd, env, killTimeoutMs = 1000 }) {
  let child;
  try {
    child = spawn(executable, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  } catch { throw new Error('Cannot launch child command'); }
  let outcome;
  const closed = new Promise(resolveClose => child.once('close', resolveClose));
  const exited = new Promise(resolveExit => {
    child.once('error', () => { outcome = { code: null, failed: true }; resolveExit(outcome); });
    child.once('exit', (code, signal) => { outcome = { code, signal }; resolveExit(outcome); });
  });
  function kill(signal) {
    if (!child.pid) return false;
    try {
      process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
      return true;
    } catch (error) { if (error.code !== 'ESRCH') throw error; return false; }
  }
  let disposing;
  const dispose = () => disposing ??= (async () => {
    if (kill(0)) {
      kill('SIGTERM');
      // Even if the leader exits, descendants may still need SIGKILL.
      await delay(killTimeoutMs);
      kill('SIGKILL');
    }
    const timer = new AbortController();
    try { await Promise.race([closed, delay(killTimeoutMs, undefined, { signal: timer.signal })]); }
    finally { timer.abort(); }
    child.stdout.destroy();
    child.stderr.destroy();
  })();
  return { child, exited, dispose, get outcome() { return outcome; } };
}

function envSecrets(env) {
  return Object.entries(env ?? {}).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(key)).map(([, value]) => value).filter(Boolean);
}

export async function runCommand(executable, args, { cwd, env = withoutModelCredentials(), signal, timeoutMs = 120000, killTimeoutMs = 1000, secrets = [], captureRawStdout = false } = {}) {
  if (signal?.aborted) throw new Error('Command aborted');
  const proc = launch(executable, args, { cwd, env, killTimeoutMs });
  let stdout = '', stderr = '';
  proc.child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-1048576); });
  proc.child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1048576); });
  let timer, onAbort;
  const interrupted = new Promise(resolveStop => {
    timer = setTimeout(() => resolveStop({ reason: 'timed out' }), timeoutMs);
    onAbort = () => resolveStop({ reason: 'aborted' });
    signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const outcome = await Promise.race([proc.exited, interrupted]);
    if (outcome.reason || outcome.code !== 0) {
      await proc.dispose();
      throw new Error(redact('Command ' + (outcome.reason ?? ('failed (exit ' + (outcome.code ?? outcome.signal ?? 'unavailable') + ')')) + ': ' + stderr + '\n' + stdout, [...envSecrets(env), ...secrets]));
    }
    // Also collect/terminate any descendants retaining the output pipes.
    await proc.dispose();
    const result = { code: 0, stdout: redact(stdout, [...envSecrets(env), ...secrets]), stderr: redact(stderr, [...envSecrets(env), ...secrets]) };
    // Machine-readable config must remain lossless without becoming log output.
    if (captureRawStdout) Object.defineProperty(result, 'rawStdout', { value: stdout });
    return result;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function startDsh({ dsh = 'dsh', args = [], home, agentsHome, profile, env = credentialEnvironment({ live: false }), port = 0, artifactDir, cwd, signal, timeoutMs = 150000, killTimeoutMs = 1000 } = {}) {
  if (signal?.aborted) throw new Error('DSH startup aborted');
  if (!home || !profile) throw new Error('DSH home and profile required');
  const childEnv = { ...env, DSH_HOME: home, DSH_AGENTS_HOME: agentsHome ?? env.DSH_AGENTS_HOME ?? join(home, 'agents') };
  const secrets = envSecrets(childEnv);
  let logPath;
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true, mode: 0o700 });
    const privateDir = await mkdtemp(join(artifactDir, 'dsh-log-'));
    await chmod(privateDir, 0o700);
    logPath = join(privateDir, 'boot.log');
    await writeFile(logPath, '', { mode: 0o600, flag: 'wx' });
  }
  const proc = launch(dsh, [...args, '--profile', profile, '--no-open', '--port', String(port)], { cwd, env: childEnv, killTimeoutMs });
  let output = '', url;
  function capture(chunk) {
    output = (output + chunk.toString()).slice(-1048576);
    for (const match of output.matchAll(/https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d+\/[^\s"'<>]*/g)) {
      try {
        const candidate = new URL(match[0].replace(/\x1b\[[0-9;]*m/g, ''));
        if (candidate.searchParams.get('token')) {
          url = candidate.href;
          if (!secrets.includes(candidate.searchParams.get('token'))) secrets.push(candidate.searchParams.get('token'));
        }
      } catch { /* Wait for a complete URL in subsequent output. */ }
    }
  }
  proc.child.stdout.on('data', capture);
  proc.child.stderr.on('data', capture);
  let disposed;
  const dispose = () => disposed ??= (async () => {
    signal?.removeEventListener('abort', onAbort);
    await proc.dispose();
    if (logPath) await writeFile(logPath, redact(output, secrets), { mode: 0o600 });
  })();
  const onAbort = () => { void dispose().catch(() => {}); };
  // Claim teardown immediately at leader exit; a delayed caller must never signal
  // a process-group id that the OS may have recycled in the meantime.
  void proc.exited.then(dispose).catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new Error('DSH startup aborted');
      if (proc.outcome) throw new Error('DSH exited before readiness');
      if (url) {
        try {
          const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(Math.max(1, Math.min(500, deadline - Date.now()))) });
          await response.body?.cancel();
          if (response.ok || ([302, 303].includes(response.status) && response.headers.has('set-cookie'))) {
            if (proc.outcome || signal?.aborted) continue;
            if (logPath) await writeFile(logPath, redact(output, secrets), { mode: 0o600 });
            const result = { origin: new URL(url).origin, pid: proc.child.pid, logPath, dispose, exited: proc.exited };
            Object.defineProperty(result, 'url', { value: url });
            return result;
          }
        } catch { /* A bound port may precede authenticated HTTP readiness. */ }
      }
      await delay(Math.min(50, Math.max(1, deadline - Date.now())));
    }
    throw new Error('DSH readiness timed out');
  } catch (error) {
    await dispose();
    throw new Error(redact(error.message + '\n' + output, secrets));
  }
}
