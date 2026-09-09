/** Canonical dependency-aware E2E and isolated development orchestration. */
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import semver from 'semver'
import { repositoryRoot, discoverPackages, planPackages, packPackages, installPackages } from './workflow-pack.mjs'
import { resolveCredentials, withoutModelCredentials, credentialEnvironment, createScratch, startDsh, runCommand, redact, isolatedGitEnvironment } from './workflow-runtime.mjs'
import { seedRuntime, validateProfile } from './workflow-fixtures.mjs'

import workflowConfig from './workflow-config.json' with { type: 'json' }
export const testedDshVersion = workflowConfig.dshVersion
const GROUPS = {
  smoke: { name: 'smoke', spec: 'tests/e2e/mount.e2e.ts', plugins: 'all', fixtures: true },
  checkpoints: { name: 'checkpoints', spec: 'tests/e2e/checkpoints.e2e.ts', plugins: ['checkpoints'], fixtures: false },
  'worktrees-sidebar': { name: 'worktrees-sidebar', spec: 'tests/e2e/worktrees-sidebar.e2e.ts', plugins: ['worktrees'], fixtures: false },
}
const LIVE_CHECKPOINTS = { name: 'checkpoints-live', spec: 'tests/e2e/checkpoints-chat.e2e.ts', plugins: ['checkpoints'], fixtures: false }
const LEGACY_SPECS = { 'tests/e2e': 'all', 'tests/e2e/mount.e2e.ts': 'smoke', 'tests/e2e/checkpoints.e2e.ts': 'checkpoints', 'tests/e2e/worktrees-sidebar.e2e.ts': 'worktrees-sidebar', 'tests/e2e/checkpoints-chat.e2e.ts': 'checkpoints' }

export function selectSuites(selector, live = false) {
  if (live) {
    if (selector !== 'checkpoints') throw new Error('Live E2E currently supports the checkpoints scenario; select it explicitly')
    return [LIVE_CHECKPOINTS]
  }
  if (selector === 'all') return Object.values(GROUPS)
  if (!Object.hasOwn(GROUPS, selector)) throw new Error('Unknown E2E group; choose all, smoke, checkpoints, or worktrees-sidebar')
  return [GROUPS[selector]]
}

function integer(value, name, max) {
  if (!/^[0-9]+$/.test(String(value)) || Number(value) > max) throw new Error(name + ' must be an integer between 0 and ' + max)
  return Number(value)
}

export function parseOptions(argv, env = process.env) {
  const [command, ...args] = argv
  if (!['e2e', 'live', 'dev', 'doctor'].includes(command)) throw new Error('Usage: workflow.mjs e2e|live|dev|doctor [selection] [options]')
  const { values, positionals } = parseArgs({ args: args[0] === '--' ? args.slice(1) : args, allowPositionals: true, strict: true, options: {
    help: { type: 'boolean', short: 'h' }, live: { type: 'boolean' }, 'env-file': { type: 'string' },
    'scratch-base': { type: 'string' }, 'artifact-dir': { type: 'string' }, dsh: { type: 'string' },
    profile: { type: 'string' }, port: { type: 'string' }, retries: { type: 'string' },
    keep: { type: 'string' }, open: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, scratch: { type: 'boolean' },
  } })
  if (values.help) return { command, help: true }
  if (positionals.length > 1) throw new Error('Select one suite or development plugin per invocation')
  const live = command === 'live' || values.live === true || env.DSH_E2E_LIVE === '1'
  if (!live && values['env-file']) throw new Error('--env-file is only valid with explicit live mode')
  if (env.E2E_EXCLUDE_PLUGINS) throw new Error('E2E_EXCLUDE_PLUGINS is no longer supported: select a suite so required dependencies cannot be omitted')
  if (command === 'dev' && positionals.length !== 1) throw new Error('Development mode requires one explicit plugin slug')
  let selector = positionals[0]
  if (!selector && command === 'e2e' && env.E2E_SPECS) {
    selector = LEGACY_SPECS[env.E2E_SPECS]
    if (!selector) throw new Error('Unsupported E2E_SPECS; use the named suite argument')
    if (env.E2E_SPECS.includes('checkpoints-chat') && !live) throw new Error('The live checkpoint spec requires explicit live mode')
  }
  selector ??= live ? 'checkpoints' : 'all'
  if (command === 'dev' && selector === 'all') throw new Error('Development mode requires one plugin slug')
  if (command !== 'dev' && command !== 'doctor') selectSuites(selector, live)
  if (command !== 'dev' && (values.profile || values.open || values.scratch)) throw new Error('--profile, --open and --scratch apply only to dev')
  const keep = values.keep ?? (env.KEEP_HOME ? 'always' : 'never')
  if (!['never', 'failure', 'always'].includes(keep)) throw new Error('--keep must be never, failure, or always')
  return {
    command, selector, live, envFile: values['env-file'],
    parent: values['scratch-base'] ?? env.DSH_HOME_BASE,
    artifactRoot: resolve(values['artifact-dir'] ?? join(repositoryRoot, 'artifacts', 'testing')),
    dsh: values.dsh ?? env.DSH_CMD ?? 'dsh',
    profile: validateProfile(values.profile ?? (command === 'dev' ? 'dev-' + selector : 'smoke')),
    port: integer(values.port ?? env.PORT ?? '0', 'port', 65535),
    retries: integer(values.retries ?? '0', 'retries', 3),
    keep, open: values.open === true, dryRun: values['dry-run'] === true,
  }
}

function defaultDependencies() {
  return { discoverPackages, planPackages, packPackages, installPackages, resolveCredentials, withoutModelCredentials,
    credentialEnvironment, createScratch, startDsh, run: runCommand, seedRuntime,
    async browserPreflight() { await access(chromium.executablePath()).catch(() => { throw new Error('Playwright Chromium is missing. Run pnpm exec playwright install chromium explicitly.') }) },
    log: (line) => console.log('[workflow] ' + line),
  }
}

async function preflight(plan, options, deps, env, signal) {
  const result = await deps.run(options.dsh, ['--version'], { cwd: repositoryRoot, env, signal })
  const version = result.stdout.trim()
  if (!semver.valid(version)) throw new Error('DSH did not report a valid semantic version')
  for (const pkg of plan.packages) {
    const range = pkg.manifest.dsh?.engines?.dsh
    if (range && !semver.satisfies(version, range, { includePrerelease: true })) throw new Error(pkg.name + ' requires DSH ' + range + '; installed ' + version)
  }
  if (options.command !== 'dev' && options.command !== 'doctor') await deps.browserPreflight()
  deps.log('DSH ' + version + '; tested target ' + testedDshVersion)
  return version
}

async function artifactDirectory(root) {
  await mkdir(root, { recursive: true, mode: 0o700 })
  return mkdtemp(join(root, 'run-'))
}

async function saveResult(dir, result) {
  await writeFile(join(dir, 'summary.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 })
}

/** Fresh home/workspaces for EVERY suite attempt; tarballs are shared read-only. */
export async function runWorkflow(options, overrides = {}, env = process.env, signal) {
  const deps = { ...defaultDependencies(), ...overrides }
  const suites = options.command === 'dev' || options.command === 'doctor' ? [] : selectSuites(options.selector, options.live)
  const local = await deps.discoverPackages(repositoryRoot)
  const all = local.filter((pkg) => pkg.manifest.dsh?.bundle).map((pkg) => pkg.name)
  const selections = options.command === 'dev' ? [options.selector]
    : options.command === 'doctor' ? all
    : [...new Set(suites.flatMap((suite) => suite.plugins === 'all' ? all : suite.plugins))]
  const plan = await deps.planPackages(selections, { root: repositoryRoot })
  if (options.dryRun) {
    const report = { mode: options.live ? 'live' : 'keyless', suites: suites.map((suite) => suite.name), packages: plan.packages.map((pkg) => pkg.name), profile: options.profile, dryRun: true }
    deps.log(JSON.stringify(report))
    return report
  }
  const credentials = await deps.resolveCredentials({ live: options.live, env, envFile: options.envFile })
  const safeEnv = isolatedGitEnvironment(deps.withoutModelCredentials(env))
  deps.log('Mode: ' + (options.live ? 'live' : 'keyless') + '; credential source: ' + credentials.source)
  const version = await preflight(plan, options, deps, safeEnv, signal)
  if (options.command === 'doctor') return { mode: options.live ? 'live' : 'keyless', credentialSource: credentials.source, dshVersion: version, packages: plan.packages.map((pkg) => pkg.name) }
  const dir = await artifactDirectory(options.artifactRoot)
  const report = { mode: options.live ? 'live' : 'keyless', dshVersion: version, packages: plan.packages.map((pkg) => pkg.name), suites: [], artifacts: dir }
  try {
    deps.log('Building and packing ' + plan.packages.length + ' runtime packages')
    const artifacts = await deps.packPackages(plan, { artifactRoot: join(dir, 'packages'), run: deps.run, env: safeEnv, signal })
    if (options.command === 'dev') {
      await runDev(options, artifacts, dir, credentials, deps, safeEnv, signal)
      report.status = 'completed'
      return report
    }
    for (const suite of suites) {
      const selected = suite.plugins === 'all' ? plan : await deps.planPackages(suite.plugins, { root: repositoryRoot })
      const names = new Set(selected.packages.map((pkg) => pkg.name))
      const packages = artifacts.filter((pkg) => names.has(pkg.name))
      let passed = false
      for (let attempt = 0; attempt <= options.retries; attempt++) {
        if (signal?.aborted) throw new Error('Workflow interrupted')
        const attemptDir = join(dir, suite.name + '-' + attempt)
        await mkdir(attemptDir, { recursive: true, mode: 0o700 })
        const started = Date.now()
        const result = await runSuite(suite, options, packages, attemptDir, credentials, deps, safeEnv, signal)
        report.suites.push({ suite: suite.name, attempt, status: result ? 'passed' : 'failed', durationMs: Date.now() - started })
        await saveResult(dir, report)
        if (result) { passed = true; break }
      }
      if (!passed) report.failed = true
    }
    report.status = report.failed ? 'failed' : 'passed'
    return report
  } catch (error) {
    report.status = 'failed'
    throw error
  } finally {
    await saveResult(dir, report)
    deps.log('Results: ' + join(dir, 'summary.json'))
  }
}

async function runSuite(suite, options, artifacts, dir, credentials, deps, safeEnv, signal) {
  const scratch = await deps.createScratch({ parent: options.parent, prefix: 'dsh-next-e2e-' })
  let server
  let passed = false
  try {
    await deps.seedRuntime(scratch, { profile: options.profile, fixtures: suite.fixtures })
    await deps.installPackages(artifacts, { home: scratch.home, profile: options.profile, dsh: options.dsh, run: deps.run, env: { ...safeEnv, ...scratch.env }, yes: true, signal })
    const runtimeEnv = { ...deps.credentialEnvironment(credentials, safeEnv), ...scratch.env, DSH_NEXT_CHECKPOINTS_CAPTURE: '1', DSH_TELEMETRY_DISABLED: '1' }
    server = await deps.startDsh({ dsh: options.dsh, home: scratch.home, agentsHome: scratch.agentsHome, profile: options.profile, env: runtimeEnv, port: options.port, artifactDir: dir, cwd: repositoryRoot, signal, timeoutMs: 150000 })
    deps.log(suite.name + ' ready at ' + server.origin)
    const testEnv = { ...safeEnv, ...scratch.env,
      DSH_E2E_URL: server.url,
      DSH_E2E_PLUGINS: artifacts.filter((pkg) => pkg.manifest.dsh?.client).map((pkg) => pkg.name).join(','),
      DSH_E2E_WORKSPACE_A: scratch.workspaceA, DSH_E2E_WORKSPACE_B: scratch.workspaceB,
      DSH_E2E_LIVE: options.live ? '1' : '', PLAYWRIGHT_HTML_OUTPUT_DIR: join(dir, 'report'),
    }
    const result = await deps.run('pnpm', ['exec', 'playwright', 'test', suite.spec, '--retries=0', '--output', join(dir, 'tests')], {
      cwd: repositoryRoot, env: testEnv, signal, timeoutMs: 900000, secrets: [server.url, credentials.apiKey],
    })
    if (result.stdout) deps.log(result.stdout)
    if (result.stderr) deps.log(result.stderr)
    passed = result.code === 0
    return passed
  } catch (error) {
    const message = redact(error.message ?? error, [credentials.apiKey, server?.url])
    deps.log(suite.name + ' failed: ' + message)
    await writeFile(join(dir, 'failure.txt'), message + '\n', { mode: 0o600 })
    return false
  } finally {
    try { await server?.dispose() } finally {
      if (options.keep === 'always' || (!passed && options.keep === 'failure')) deps.log('Retained private scratch: ' + scratch.root)
      else await scratch.dispose()
    }
  }
}

async function runDev(options, artifacts, dir, credentials, deps, safeEnv, signal) {
  const scratch = await deps.createScratch({ parent: options.parent, prefix: 'dsh-next-dev-' })
  let server
  let failed = true
  try {
    await deps.seedRuntime(scratch, { profile: options.profile, fixtures: false })
    await deps.installPackages(artifacts, { home: scratch.home, profile: options.profile, dsh: options.dsh, run: deps.run, env: { ...safeEnv, ...scratch.env }, yes: true, signal })
    server = await deps.startDsh({ dsh: options.dsh, home: scratch.home, agentsHome: scratch.agentsHome, profile: options.profile, env: { ...deps.credentialEnvironment(credentials, safeEnv), ...scratch.env, DSH_TELEMETRY_DISABLED: '1' }, port: options.port, artifactDir: dir, cwd: repositoryRoot, signal, timeoutMs: 150000 })
    const urlFile = join(dir, 'browser-url.txt')
    await writeFile(urlFile, server.url + '\n', { mode: 0o600 })
    deps.log('Development runtime: ' + server.origin + '; private login URL: ' + urlFile)
    if (options.open) {
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null
      if (!opener) throw new Error('Automatic browser opening is unsupported on this platform; use the private URL file')
      await deps.run(opener, [server.url], { env: safeEnv, signal, secrets: [server.url] })
    }
    const exit = await server.exited
    if (!signal?.aborted && (exit?.code !== 0 || exit.signal || exit.failed)) throw new Error('Development runtime exited unexpectedly: ' + (exit?.signal ?? exit?.code ?? 'launch failure'))
    failed = false
  } finally {
    try { await server?.dispose() } finally {
      if (options.keep === 'always' || (failed && options.keep === 'failure')) deps.log('Retained private scratch: ' + scratch.root)
      else await scratch.dispose()
    }
  }
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseOptions(argv, env)
  if (options.help) {
    console.log('Usage: workflow.mjs e2e [all|smoke|checkpoints|worktrees-sidebar] | live [checkpoints] | dev <slug> | doctor\nOptions: --live --env-file PATH --dsh PATH --scratch-base PATH --artifact-dir PATH --keep never|failure|always --retries N --port N --dry-run\nDev only: --profile NAME --open --scratch (always isolated). No command modifies or restarts an existing profile.')
    return 0
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)
  try {
    const result = await runWorkflow(options, {}, env, controller.signal)
    if (options.command === 'doctor') console.log(JSON.stringify(result, null, 2))
    return controller.signal.aborted ? 130 : result.failed ? 1 : 0
  } catch (error) {
    if (controller.signal.aborted) return 130
    throw error
  } finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then((code) => { process.exitCode = code }, (error) => { console.error('[workflow] ' + error.message); process.exitCode = 1 })
}
