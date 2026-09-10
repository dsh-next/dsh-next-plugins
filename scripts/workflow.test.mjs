import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseOptions, selectSuites, runWorkflow, testedDshVersion } from './workflow.mjs'

async function fixture(t, behavior = {}) {
  const root = await mkdtemp(join(tmpdir(), 'workflow-orchestration-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const records = ['checkpoints', 'worktrees', 'skills'].map(slug => ({
    name: '@dsh-next/dsh-next-' + slug, slug, version: '0.1.0',
    manifest: { dsh: { bundle: { patch: './cordis.patch.yml' }, client: {}, engines: { dsh: '>=0.1.3-alpha.2' } } },
  }))
  const events = [], runs = [], roots = []
  let packed = 0
  const deps = {
    log: message => events.push(['log', message]),
    discoverPackages: async () => records,
    planPackages: async selectors => {
      const packages = records.filter(pkg => selectors.includes(pkg.name) || selectors.includes(pkg.slug))
      // Model a required local plugin dependency shared by focused suites.
      if (packages.some(pkg => pkg.slug === 'checkpoints') && !packages.includes(records[2])) packages.unshift(records[2])
      return { packages, requested: packages, buildPackages: packages }
    },
    resolveCredentials: async ({ live }) => {
      events.push(['credentials', live])
      if (behavior.credentialsError) throw new Error('Live credential unavailable')
      return { live, source: live ? 'environment' : 'keyless', apiKey: live ? 'synthetic-live-secret' : 'fake-e2e-key' }
    },
    browserPreflight: async () => { events.push(['browser']) },
    run: async (command, args, options) => {
      events.push(['run', command, args])
      // The workflow is only ever driven against the CLI CI actually installs.
      if (args.includes('--version')) return { stdout: behavior.version ?? testedDshVersion, stderr: '', code: 0 }
      runs.push({ command, args, options })
      if (behavior.command) return behavior.command(command, args, options, runs.length)
      return { stdout: 'one test passed', stderr: '', code: 0 }
    },
    packPackages: async (plan, options) => {
      packed++
      events.push(['pack', options])
      if (behavior.packError) throw new Error('pack failed')
      return plan.packages.map(pkg => ({ ...pkg, path: join(root, pkg.slug + '.tgz'), sha256: 'a'.repeat(64) }))
    },
    createScratch: async () => {
      const id = roots.length
      const path = join(root, 'scratch-' + id)
      const scratch = { root: path, home: join(path, 'home'), agentsHome: join(path, 'agents'),
        workspaceA: join(path, 'workspace-a'), workspaceB: join(path, 'workspace-b'),
        env: { DSH_HOME: join(path, 'home'), DSH_AGENTS_HOME: join(path, 'agents') },
        dispose: async () => events.push(['scratch-dispose', path]),
      }
      roots.push(scratch)
      return scratch
    },
    seedRuntime: async (scratch, options) => events.push(['seed', scratch.root, options.fixtures]),
    installPackages: async (artifacts, options) => {
      events.push(['install', artifacts.map(pkg => pkg.slug), options])
      if (behavior.installError) throw new Error('install failed')
    },
    startDsh: async options => {
      events.push(['start', options])
      if (behavior.bootError) throw new Error('boot failed')
      return { origin: 'http://127.0.0.1:1234', url: 'http://127.0.0.1:1234/?token=synthetic-bootstrap',
        dispose: async () => { events.push(['server-dispose', options.home]) }, exited: Promise.resolve(behavior.exit ?? { code: behavior.exitCode ?? 0 }),
      }
    },
  }
  const options = { ...parseOptions(['e2e'], {}), artifactRoot: join(root, 'artifacts') }
  return { root, events, runs, roots, deps, options, get packed() { return packed } }
}

test('suite registry accounts for every committed E2E spec', async () => {
  const actual = (await readdir(new URL('../tests/e2e/', import.meta.url))).filter(name => name.endsWith('.e2e.ts')).sort()
  const selected = [...selectSuites('all'), ...selectSuites('checkpoints', true)].map(suite => suite.spec.split('/').at(-1)).sort()
  assert.deepEqual(selected, actual)
})

test('default full E2E explicitly includes every keyless scenario group', () => {
  assert.deepEqual(selectSuites('all').map(s => s.name), ['smoke', 'checkpoints', 'worktrees-sidebar'])
  assert.equal(selectSuites('checkpoints', true)[0].spec, 'tests/e2e/checkpoints-chat.e2e.ts')
  assert.throws(() => selectSuites('all', true), /select it explicitly/)
  assert.throws(() => selectSuites('missing'), /Unknown/)
})

test('CLI validates options, preserves spaces, accepts forwarded delimiter and safe legacy selection', () => {
  const options = parseOptions(['live', '--', 'checkpoints', '--env-file', '/tmp/with spaces.env', '--retries', '2'], {})
  assert.equal(options.live, true)
  assert.equal(options.envFile, '/tmp/with spaces.env')
  assert.equal(options.retries, 2)
  assert.equal(parseOptions(['e2e'], { E2E_SPECS: 'tests/e2e/checkpoints.e2e.ts' }).selector, 'checkpoints')
  assert.equal(parseOptions(['dev', 'skills', '--scratch', '--profile', 'chosen'], {}).profile, 'chosen')
  assert.equal(parseOptions(['e2e', '--help'], {}).help, true)
  for (const args of [[], ['nope'], ['dev'], ['dev', '--live'], ['e2e', 'a', 'b'], ['e2e', '--env-file', 'x'], ['e2e', '--profile', 'web'], ['dev', 'skills', '--profile', '../web'], ['e2e', '--port', '65536'], ['e2e', '--retries', '-1'], ['e2e', '--keep', 'sometimes'], ['e2e', '--port']]) {
    assert.throws(() => parseOptions(args, {}), undefined, args.join(' '))
  }
  assert.throws(() => parseOptions(['e2e'], { E2E_EXCLUDE_PLUGINS: 'skills' }), /cannot be omitted/)
  assert.throws(() => parseOptions(['e2e'], { E2E_SPECS: 'unknown/path' }), /Unsupported/)
  assert.throws(() => parseOptions(['e2e'], { E2E_SPECS: 'tests/e2e/checkpoints-chat.e2e.ts' }), /live mode/)
})

test('dry run does not read credentials, launch commands, create artifacts or scratch', async t => {
  const f = await fixture(t)
  const report = await runWorkflow({ ...f.options, live: true, selector: 'checkpoints', dryRun: true }, f.deps, {})
  assert.equal(report.dryRun, true)
  assert.equal(f.packed, 0)
  assert.equal(f.roots.length, 0)
  assert.equal(f.events.filter(e => e[0] !== 'log').length, 0)
  assert.deepEqual(await readdir(f.root), [])
})

test('credentials fail before any build, commands or runtime side effects', async t => {
  const f = await fixture(t, { credentialsError: true })
  await assert.rejects(runWorkflow({ ...f.options, live: true, selector: 'checkpoints' }, f.deps, {}), /credential/)
  assert.deepEqual(f.events, [['credentials', true]])
  assert.equal(f.packed, 0)
  assert.deepEqual(await readdir(f.root), [])
})

test('runtime incompatibility fails before packing and scratch', async t => {
  const f = await fixture(t, { version: '0.1.2-rc.1' })
  await assert.rejects(runWorkflow(f.options, f.deps, {}), /requires DSH/)
  assert.equal(f.packed, 0)
  assert.equal(f.roots.length, 0)
})

test('full suite packs once, preserves dependency closure, and isolates every group', async t => {
  const f = await fixture(t)
  const report = await runWorkflow(f.options, f.deps, { DEEPSEEK_API_KEY: 'never-use-real-key', OPENAI_API_KEY: 'also-not-for-tests' })
  assert.equal(report.status, 'passed')
  assert.equal(f.packed, 1)
  assert.equal(new Set(f.roots.map(s => s.home)).size, 3)
  assert.equal(f.events.filter(e => e[0] === 'server-dispose').length, 3)
  assert.equal(f.events.filter(e => e[0] === 'scratch-dispose').length, 3)
  const focused = f.events.filter(e => e[0] === 'install')[1]
  assert.deepEqual(focused[1], ['checkpoints', 'skills'])
  for (const run of f.runs) {
    assert.equal(run.options.env.DEEPSEEK_API_KEY, undefined)
    assert.equal(run.options.env.OPENAI_API_KEY, undefined)
    assert.equal(run.options.env.DSH_E2E_LIVE, '')
    assert.ok(run.args.includes('--retries=0'))
  }
  for (const [, options] of f.events.filter(e => e[0] === 'start')) assert.equal(options.env.DEEPSEEK_API_KEY, 'fake-e2e-key')
  const saved = await readFile(join(report.artifacts, 'summary.json'), 'utf8')
  assert.equal(saved.includes('synthetic-bootstrap'), false)
  assert.equal(saved.includes('never-use-real-key'), false)
})

test('failed group retries against fresh state without rebuilding and continues other groups', async t => {
  const f = await fixture(t, { command: async (_command, _args, _options, call) => ({ stdout: '', stderr: '', code: call === 1 ? 1 : 0 }) })
  const report = await runWorkflow({ ...f.options, retries: 1 }, f.deps, {})
  assert.equal(report.status, 'passed')
  assert.deepEqual(report.suites.map(s => s.status), ['failed', 'passed', 'passed', 'passed'])
  assert.equal(f.packed, 1)
  assert.equal(f.roots.length, 4)
  assert.equal(f.events.filter(e => e[0] === 'scratch-dispose').length, 4)
})

test('failure summary is non-green and retained scratch is opt-in', async t => {
  const f = await fixture(t, { command: async () => { throw new Error('test assertion failed') } })
  const report = await runWorkflow({ ...f.options, selector: 'checkpoints', keep: 'failure' }, f.deps, {})
  assert.equal(report.status, 'failed')
  assert.equal(report.failed, true)
  assert.equal(f.events.filter(e => e[0] === 'server-dispose').length, 1)
  assert.equal(f.events.filter(e => e[0] === 'scratch-dispose').length, 0)
  assert.match(await readFile(join(report.artifacts, 'checkpoints-0', 'failure.txt'), 'utf8'), /assertion failed/)
})

for (const stage of ['installError', 'bootError']) test(stage + ' disposes scratch and records failed suite', async t => {
  const f = await fixture(t, { [stage]: true })
  const report = await runWorkflow({ ...f.options, selector: 'checkpoints' }, f.deps, {})
  assert.equal(report.status, 'failed')
  assert.equal(f.events.filter(e => e[0] === 'scratch-dispose').length, 1)
})

test('pack failure records summary without ever creating runtime state', async t => {
  const f = await fixture(t, { packError: true })
  await assert.rejects(runWorkflow(f.options, f.deps, {}), /pack failed/)
  assert.equal(f.roots.length, 0)
  const [dir] = await readdir(f.options.artifactRoot)
  const report = JSON.parse(await readFile(join(f.options.artifactRoot, dir, 'summary.json'), 'utf8'))
  assert.equal(report.status, 'failed')
})

test('cancellation signal reaches packing and every profile installation', async t => {
  const f = await fixture(t)
  const controller = new AbortController()
  await runWorkflow(f.options, f.deps, {}, controller.signal)
  assert.equal(f.events.find(e => e[0] === 'pack')[1].signal, controller.signal)
  for (const event of f.events.filter(e => e[0] === 'install')) assert.equal(event[2].signal, controller.signal)
})

test('live credentials reach runtime only, not Playwright or installation', async t => {
  const f = await fixture(t)
  const report = await runWorkflow({ ...f.options, live: true, selector: 'checkpoints' }, f.deps, {})
  assert.equal(report.status, 'passed')
  assert.equal(f.events.find(e => e[0] === 'start')[1].env.DEEPSEEK_API_KEY, 'synthetic-live-secret')
  assert.equal(f.events.find(e => e[0] === 'install')[2].env.DEEPSEEK_API_KEY, undefined)
  assert.equal(f.runs[0].options.env.DEEPSEEK_API_KEY, undefined)
  assert.equal(f.runs[0].options.env.DSH_E2E_LIVE, '1')
})

test('doctor reports safe metadata without build or runtime', async t => {
  const f = await fixture(t)
  const result = await runWorkflow({ ...f.options, command: 'doctor' }, f.deps, {})
  assert.equal(result.dshVersion, testedDshVersion)
  assert.ok(f.events.some(([kind, message]) => kind === 'log' && message.endsWith('tested target ' + testedDshVersion)))
  assert.equal(f.packed, 0)
  assert.equal(f.roots.length, 0)
  assert.equal(JSON.stringify(result).includes('apiKey'), false)
})

test('externally killed dev runtime fails and retains requested failure evidence', async t => {
  const f = await fixture(t, { exit: { code: null, signal: 'SIGKILL' } })
  await assert.rejects(runWorkflow({ ...f.options, command: 'dev', selector: 'checkpoints', keep: 'failure' }, f.deps, {}), /unexpectedly: SIGKILL/)
  assert.equal(f.events.filter(e => e[0] === 'server-dispose').length, 1)
  assert.equal(f.events.filter(e => e[0] === 'scratch-dispose').length, 0)
})

test('dev uses isolated roots and disposes on natural exit without touching real home', async t => {
  const f = await fixture(t)
  const report = await runWorkflow({ ...f.options, command: 'dev', selector: 'checkpoints', profile: 'dev-checkpoints' }, f.deps, { DSH_HOME: '/do-not-touch' })
  assert.equal(report.status, 'completed')
  assert.notEqual(f.events.find(e => e[0] === 'install')[2].home, '/do-not-touch')
  assert.equal(f.events.filter(e => e[0] === 'scratch-dispose').length, 1)
  assert.equal(f.events.filter(e => e[0] === 'server-dispose').length, 1)
})
