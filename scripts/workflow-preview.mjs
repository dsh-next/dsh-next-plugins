/** Owned, keyless skills inspection recipe. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { repositoryRoot, planPackages, packPackages, installPackages } from './workflow-pack.mjs';
import { resolveCredentials, withoutModelCredentials, createScratch, startDsh, runCommand, redact, isolatedGitEnvironment } from './workflow-runtime.mjs';
import { seedRuntime } from './workflow-fixtures.mjs';

export function parsePreviewOptions(argv, env = process.env) {
  const [mode, ...args] = argv;
  if (mode !== 'skills') throw new Error('Choose the skills preview');
  const { values, positionals } = parseArgs({ args: args[0] === '--' ? args.slice(1) : args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, keep: { type: 'boolean' },
    'scratch-base': { type: 'string' }, dsh: { type: 'string' },
  } });
  if (values.help) return { mode, help: true };
  if (positionals.length) throw new Error('Preview does not accept positional arguments');
  if (env.SKILLS_E2E_OVERWRITE) throw new Error('SKILLS_E2E_OVERWRITE is retired; use --scratch-base for a newly owned child');
  const legacyPort = env.SKILLS_E2E_PORT ?? env.PORT;
  if (legacyPort && legacyPort !== '0') throw new Error('Preview always uses an OS-assigned port; unset PORT and SKILLS_E2E_PORT');
  return { mode, parent: values['scratch-base'] ?? env.SKILLS_E2E_HOME ?? env.DSH_HOME_BASE,
    dsh: values.dsh ?? env.DSH_CMD ?? 'dsh', keep: values.keep === true || env.KEEP_HOME === '1' };
}

async function skillsRecipe(scratch, settings) {
  // All copies are global; native frontmatter alone controls invocation.
  const recipes = {
    'grill-me': '---\nname: grill-me\ndescription: Ask me a hard question and grill me on the answer.\n---\n# Changelog\n',
    opentofu: '---\nname: opentofu\ndescription: |\n  Terraform / OpenTofu infrastructure as code help.\n  Handles plan, apply, and state review.\ndisable-model-invocation: true\nuser-invocable: false\n---\n# Ops\n',
    'hand-made': '---\nname: hand-made\ndescription: Hand-created skill with no provider provenance record.\n---\n# Hand\n',
  };
  for (const [name, content] of Object.entries(recipes)) {
    const dir = join(scratch.agentsHome, 'skills', name);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(join(dir, 'SKILL.md'), content, { mode: 0o600, flag: 'wx' });
  }
  const config = settings['dsh-next-skills'];
  for (const name of ['grill-me', 'opentofu']) config.installations.push({ name, providerId: 'e2e-local', providerSpec: 'e2e/local', skillPath: 'skills/' + name, version: 'seed-v1', installedAt: '2026-01-01T00:00:00.000Z' });
}

export async function runPreview(options, dependencies = {}) {
  const { env = process.env, signal, ...overrides } = dependencies;
  const deps = { planPackages, packPackages, installPackages, createScratch, seedRuntime, startDsh, run: runCommand, log: line => console.log('[preview] ' + line), ...overrides };
  if (options.mode !== 'skills') throw new Error('Choose the skills preview');
  if (signal?.aborted) throw new Error('Preview aborted');
  // These entrypoints are never live, even with inherited keys or env-file selectors.
  const credentials = await resolveCredentials({ live: false, env });
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  signal?.addEventListener('abort', forwardAbort, { once: true });
  if (signal?.aborted) forwardAbort();
  let scratch, runtime;
  const secrets = Object.entries(env).filter(([key]) => /KEY|TOKEN|SECRET|PASSWORD/i.test(key)).map(([, value]) => value);
  try {
    const plan = await deps.planPackages([options.mode], { root: repositoryRoot });
    scratch = await deps.createScratch({ parent: options.parent, prefix: 'dsh-next-preview-' });
    const profile = 'preview-skills';
    const artifactDir = join(scratch.root, 'artifacts');
    await mkdir(artifactDir, { mode: 0o700 });
    // Git routing/config environment must not redirect fixture writes into a
    // caller's checkout; the recipe supplies only its private repository.
    const runtimeEnv = { ...isolatedGitEnvironment(credentials.env), ...scratch.env };
    const buildEnv = withoutModelCredentials(runtimeEnv);
    await deps.seedRuntime(scratch, { profile, fixtures: true });
    const settingsPath = join(scratch.home, 'settings.yaml');
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
    await skillsRecipe(scratch, settings);
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
    const artifacts = await deps.packPackages(plan, { artifactRoot: join(artifactDir, 'packages'), env: buildEnv, run: deps.run, signal: controller.signal });
    await deps.installPackages(artifacts, { home: scratch.home, profile, yes: true, dsh: options.dsh, env: buildEnv, run: deps.run, signal: controller.signal });
    runtime = await deps.startDsh({ dsh: options.dsh, home: scratch.home, agentsHome: scratch.agentsHome, profile, env: runtimeEnv, port: 0, artifactDir, signal: controller.signal });
    secrets.push(runtime.url, new URL(runtime.url).searchParams.get('token'));
    const urlFile = join(artifactDir, 'browser.url');
    await writeFile(urlFile, runtime.url + '\n', { mode: 0o600, flag: 'wx' });
    deps.log('Ready at ' + runtime.origin + '; private browser URL file: ' + urlFile);
    deps.log('Owned scratch: ' + scratch.root + (options.keep ? ' (retained)' : ' (removed on exit)'));
    const unexpectedExit = runtime.exited.then(() => { controller.abort(); return 'exit'; });
    let onAbort;
    const aborted = new Promise(resolveAbort => {
      onAbort = () => resolveAbort('abort');
      controller.signal.addEventListener('abort', onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    try {
      await Promise.race([unexpectedExit, aborted]);
      if (!signal?.aborted) throw new Error('Preview DSH exited unexpectedly');
    } finally { controller.signal.removeEventListener('abort', onAbort); }
    return { mode: options.mode, origin: runtime.origin, root: scratch.root, urlFile };
  } catch (error) {
    throw new Error(redact(error.message, secrets));
  } finally {
    signal?.removeEventListener('abort', forwardAbort);
    try { await runtime?.dispose(); }
    finally {
      if (scratch && !options.keep) await scratch.dispose();
      else if (scratch) deps.log(redact('Retained owned scratch: ' + scratch.root, secrets));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const controller = new AbortController();
  let exitSignal;
  const onInt = () => { exitSignal = 'SIGINT'; controller.abort(); };
  const onTerm = () => { exitSignal = 'SIGTERM'; controller.abort(); };
  process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
  try {
    const options = parsePreviewOptions(process.argv.slice(2));
    if (options.help) console.log('Usage: workflow-preview.mjs skills [--scratch-base DIR] [--dsh EXECUTABLE] [--keep]\nAlways keyless with a new owned scratch child and OS-assigned port. KEEP_HOME=1 retains it. SKILLS_E2E_HOME is a parent only.');
    else await runPreview(options, { signal: controller.signal });
  } catch (error) {
    if (!exitSignal) { console.error(redact(error.message)); process.exitCode = 1; }
  } finally {
    process.removeListener('SIGINT', onInt); process.removeListener('SIGTERM', onTerm);
    if (exitSignal) process.exitCode = exitSignal === 'SIGINT' ? 130 : 143;
  }
}
