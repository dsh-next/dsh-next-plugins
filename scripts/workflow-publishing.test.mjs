import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import { parseDocument } from 'yaml'

const repository = fileURLToPath(new URL('../', import.meta.url))
const workflows = {}
for (const name of ['ci', 'release', 'canary']) {
  const document = parseDocument(await readFile(join(repository, '.github/workflows', `${name}.yml`), 'utf8'))
  assert.deepEqual(document.errors, [], `${name} must be valid YAML without duplicate keys`)
  workflows[name] = document.toJS()
}
const { ci, release, canary } = workflows
const context = (overrides = {}) => ({
  github: { workflow: 'CI', event_name: 'workflow_dispatch', ref: 'refs/heads/main',
    sha: 'a'.repeat(40), run_id: 101, event: { pull_request: {} }, ...overrides.github },
  inputs: { ...overrides.inputs },
  needs: { ...overrides.needs },
})
// These workflow conditions use the same boolean/string operators as JavaScript.
// Evaluate the actual YAML expressions, not a duplicate of each workflow guard.
const evaluate = (expression, variables) => runInNewContext(expression, variables, { timeout: 100 })
const condition = (expression, variables) => expression === undefined || Boolean(evaluate(expression, variables))
const expand = (template, variables) => template.replace(/\$\{\{\s*(.*?)\s*\}\}/g,
  (_, expression) => String(evaluate(expression, variables)))
const dependencies = job => [job.needs ?? []].flat()
const checkout = job => job.steps.find(step => step.uses?.startsWith('actions/checkout@'))
const stepNamed = (job, name) => {
  const step = job.steps.find(step => step.name === name)
  assert.ok(step, `Missing workflow step: ${name}`)
  return step
}

test('publishing callers reuse all keyless CI gates on their exact triggering SHA without secrets', () => {
  assert.ok(Object.hasOwn(ci.on, 'workflow_call'))
  assert.deepEqual(ci.on.workflow_call ?? {}, {}, 'No reusable inputs or secret interface is needed')
  assert.deepEqual(ci.permissions, { contents: 'read' })
  assert.equal(ci.env, undefined)
  for (const [workflow, publisher] of [[release, 'release'], [canary, 'canary']]) {
    const validation = workflow.jobs.validation
    assert.equal(validation.uses, './.github/workflows/ci.yml')
    assert.equal(validation.with, undefined, 'Do not let callers select another ref or activate live tests')
    assert.equal(validation.secrets, undefined, 'Never inherit NPM_TOKEN or live credentials')
    assert.equal(validation.env, undefined)
    assert.equal(validation['continue-on-error'], undefined)
    assert.deepEqual(validation.permissions, { contents: 'read' })
    assert.deepEqual(dependencies(workflow.jobs[publisher]), ['validation'])
    assert.equal(workflow.jobs[publisher]['continue-on-error'], undefined)
    assert.deepEqual(workflow.permissions, { contents: 'read' })
    assert.equal(workflow.env, undefined)
    assert.equal(checkout(workflow.jobs[publisher]).with.ref, '${{ github.sha }}')
  }
  for (const jobName of ['ci', 'plugin-mount']) {
    const job = ci.jobs[jobName]
    assert.equal(job.if, undefined, `${jobName} must not be skipped for publishing callers`)
    assert.equal(job['continue-on-error'], undefined)
    assert.equal(job.permissions, undefined, 'Keyless jobs inherit only contents:read')
    assert.equal(checkout(job).with.ref, '${{ github.sha }}')
    assert.equal(checkout(job).with['persist-credentials'], false)
    assert.doesNotMatch(JSON.stringify(job), /secrets\.|NPM_TOKEN|DEEPSEEK_API_KEY|OPENAI_API_KEY|test:live/)
    for (const step of job.steps) assert.equal(step['continue-on-error'], undefined)
  }
  assert.equal(stepNamed(ci.jobs.ci, 'Ordered static checks (including script tests)').run, 'pnpm run check')
  assert.equal(stepNamed(ci.jobs['plugin-mount'], 'All keyless suites (fresh runtime per suite attempt)').run, 'pnpm run test:e2e')
})

test('failed, cancelled, or skipped validation blocks publishing rather than bypassing needs', () => {
  for (const [workflow, publisher] of [[release, 'release'], [canary, 'canary']]) {
    const job = workflow.jobs[publisher]
    assert.doesNotMatch(job.if ?? '', /always\(|failure\(|cancelled\(|!\s*cancelled/,
      'Publishing must retain the implicit success() dependency check')
    for (const result of ['success', 'failure', 'cancelled', 'skipped']) {
      const variables = context({ needs: { validation: { result } } })
      const runnable = dependencies(job).every(name => variables.needs[name].result === 'success')
        && condition(job.if, variables)
      assert.equal(runnable, result === 'success', `${workflow.name}: validation ${result}`)
    }
  }
})

test('Canary rejects non-main contexts and restricts the dispatch choice to non-stable tags', () => {
  assert.deepEqual(Object.keys(canary.on), ['workflow_dispatch'])
  assert.deepEqual(canary.on.workflow_dispatch.inputs.tag.options, ['canary', 'beta', 'rc'])
  assert.equal(canary.on.workflow_dispatch.inputs.tag.type, 'choice')
  assert.equal(canary.on.workflow_dispatch.inputs.tag.default, 'canary')
  assert.equal(canary.on.workflow_dispatch.inputs.tag.required, true)
  assert.deepEqual(release.on.push.branches, ['main'])
  for (const ref of ['refs/heads/main', 'refs/heads/dev', 'refs/heads/feature', 'refs/tags/main']) {
    for (const job of [canary.jobs.validation, canary.jobs.canary]) {
      assert.equal(condition(job.if, context({ github: { ref } })), ref === 'refs/heads/main')
    }
  }
})

test('only direct manual CI on main with explicit opt-in can use the protected live environment', () => {
  const input = ci.on.workflow_dispatch.inputs.live_checkpoints
  assert.equal(input.type, 'boolean')
  assert.equal(input.default, false)
  const live = ci.jobs['live-checkpoints']
  assert.equal(live.environment, 'live-tests')
  for (const workflow of ['CI', 'Release', 'Canary']) {
    for (const event_name of ['workflow_dispatch', 'push', 'pull_request', 'workflow_call']) {
      for (const ref of ['refs/heads/main', 'refs/heads/dev']) {
        for (const live_checkpoints of [undefined, false, true]) {
          const variables = context({ github: { workflow, event_name, ref }, inputs: { live_checkpoints } })
          assert.equal(condition(live.if, variables), workflow === 'CI' && event_name === 'workflow_dispatch'
            && ref === 'refs/heads/main' && live_checkpoints === true,
          JSON.stringify({ workflow, event_name, ref, live_checkpoints }))
        }
      }
    }
  }
  assert.equal(checkout(live).with.ref, '${{ github.sha }}')
  assert.equal(stepNamed(live, 'Live checkpoint capture and rewind').env.DEEPSEEK_API_KEY, '${{ secrets.DEEPSEEK_API_KEY }}')
})

test('reusable CI cannot cancel its caller or another publishing run; direct CI still supersedes stale checks', () => {
  assert.equal(ci.concurrency['cancel-in-progress'], true)
  const direct = id => expand(ci.concurrency.group, context({ github: { run_id: id } }))
  assert.equal(direct(101), direct(102))
  assert.notEqual(direct(101), expand(ci.concurrency.group, context({ github: { ref: 'refs/heads/dev' } })))
  for (const workflow of [release, canary]) {
    assert.equal(workflow.concurrency['cancel-in-progress'], false)
    const called = id => context({ github: { workflow: workflow.name, run_id: id } })
    const validationGroup = expand(ci.concurrency.group, called(101))
    assert.notEqual(validationGroup, expand(workflow.concurrency.group, called(101)))
    assert.notEqual(validationGroup, expand(ci.concurrency.group, called(102)))
    assert.notEqual(validationGroup, direct(101))
  }
  assert.notEqual(expand(ci.concurrency.group, context({ github: { workflow: 'Release' } })),
    expand(ci.concurrency.group, context({ github: { workflow: 'Canary' } })))
})

test('permissions are scoped to stable publishing; Canary cannot create or push git tags', () => {
  assert.deepEqual(release.jobs.release.permissions, { contents: 'write', 'pull-requests': 'write' })
  assert.equal(release.jobs['checkout-smoke'].permissions, undefined, 'Smoke inherits only contents:read')
  assert.equal(canary.jobs.canary.permissions, undefined, 'Canary inherits only contents:read')
  assert.equal(checkout(canary.jobs.canary).with['persist-credentials'], false)
  const snapshot = stepNamed(canary.jobs.canary, 'Publish canary snapshot')
  assert.match(snapshot.run, /changeset publish --tag "\$TAG" --no-git-tag/)
  assert.doesNotMatch(JSON.stringify(canary), /\bgit\s+(?:tag|push)\b|changeset tag|changesets\/action|contents":"write/)
  const stable = release.jobs.release.steps.find(step => step.id === 'changesets')
  assert.equal(stable.uses, 'changesets/action@v2.1.1')
  assert.equal(stable.with['create-github-releases'], true)
  assert.equal(stable.with['push-git-tags'], true)
  assert.equal(stable.env.GITHUB_TOKEN, '${{ secrets.GITHUB_TOKEN }}')
})

test('post-publish smoke honestly checks checkout tarballs, not published registry artifacts', () => {
  const smoke = release.jobs['checkout-smoke']
  assert.deepEqual(dependencies(smoke), ['release'])
  assert.equal(condition(smoke.if, context({ needs: { release: { outputs: { changesets_published: 'true' } } } })), true)
  for (const published of ['false', '', undefined]) {
    assert.equal(condition(smoke.if, context({ needs: { release: { outputs: { changesets_published: published } } } })), false)
  }
  assert.equal(checkout(smoke).with.ref, '${{ github.sha }}')
  assert.equal(checkout(smoke).with['persist-credentials'], false)
  assert.equal(stepNamed(smoke, 'Checkout tarball mount smoke').run, 'pnpm run test:e2e -- smoke')
  assert.doesNotMatch(JSON.stringify(smoke), /secrets\.|NPM_TOKEN|DEEPSEEK_API_KEY|registry smoke/i)
})

test('validation and checkout smoke preserve canonical root scripts, CLI pin, and browser setup', () => {
  for (const workflow of [ci, release, canary]) assert.equal(workflow.defaults?.run?.['working-directory'], undefined)
  for (const job of [ci.jobs.ci, ci.jobs['plugin-mount'], ci.jobs['live-checkpoints'],
    release.jobs.release, release.jobs['checkout-smoke'], canary.jobs.canary]) {
    const setup = job.steps.find(step => step.uses?.startsWith('pnpm/action-setup@'))
    assert.equal(setup.with?.version, undefined, 'Root packageManager is the only pnpm version authority')
    const node = job.steps.find(step => step.uses?.startsWith('actions/setup-node@'))
    assert.equal(node.with['node-version'], 22)
    assert.equal(stepNamed(job, 'Install dependencies').run, 'pnpm install --frozen-lockfile --ignore-scripts')
    assert.equal(job.defaults?.run?.['working-directory'], undefined)
    for (const step of job.steps) assert.equal(step['working-directory'], undefined)
  }
  for (const job of [ci.jobs['plugin-mount'], ci.jobs['live-checkpoints'], release.jobs['checkout-smoke']]) {
    const cli = job.steps.find(step => step.run?.includes('npm install -g'))
    assert.equal(cli.run, 'npm install -g "@deepseek-ai/dsh@$(node -p "require(\'./scripts/workflow-config.json\').dshVersion")"')
    assert.equal(stepNamed(job, 'Install Playwright Chromium').run, 'pnpm exec playwright install --with-deps chromium')
  }
})

const canaryJob = canary.jobs.canary
const validateTag = stepNamed(canaryJob, 'Validate prerelease tag')
const configureAuth = stepNamed(canaryJob, 'Configure npm auth')
const publishSnapshot = stepNamed(canaryJob, 'Publish canary snapshot')

test('dispatch data reaches shell only via TAG, validated before credentials or any commands', () => {
  assert.deepEqual(canaryJob.env, { TAG: '${{ inputs.tag }}' })
  assert.equal(canaryJob.steps[0], validateTag)
  assert.equal(validateTag.shell, 'bash')
  assert.equal(validateTag.env, undefined)
  for (const step of canaryJob.steps) {
    assert.doesNotMatch(step.run ?? '', /\$\{\{/, 'Do not interpolate dispatch data into shell source')
    assert.equal(step['continue-on-error'], undefined)
  }
  assert.deepEqual(configureAuth.env, { NPM_TOKEN: '${{ secrets.NPM_TOKEN }}' })
  assert.deepEqual(publishSnapshot.env, { NPM_TOKEN: '${{ secrets.NPM_TOKEN }}' })
  assert.match(publishSnapshot.run, /version --snapshot "\$TAG"/)
  assert.match(publishSnapshot.run, /publish --tag "\$TAG" --no-git-tag/)
})

async function mockDispatch(t, tag, { snapshotExit = 0, publishExit = 0 } = {}) {
  const artifactRoot = resolve(repository, 'artifacts/testing')
  await mkdir(artifactRoot, { recursive: true })
  const root = await mkdtemp(join(artifactRoot, 'publishing-probe-'))
  t.after(async () => {
    assert.equal(dirname(resolve(root)), artifactRoot, 'Cleanup must stay inside the verified probe directory')
    await rm(root, { recursive: true, force: true })
  })
  const log = join(root, 'commands')
  // Shell functions intercept every version/publish call; no real pnpm, npm,
  // git, registry, model, or GitHub command is launched by these probes.
  const mocks = `
    pnpm() {
      printf '%s\\0' "$@" >> "$PROBE_LOG"
      printf '\\n' >> "$PROBE_LOG"
      if [ "$3" = version ]; then return "$SNAPSHOT_EXIT"; fi
      return "$PUBLISH_EXIT"
    }
    npm() { printf 'unexpected npm\\n' >> "$PROBE_LOG"; return 99; }
    git() { printf 'unexpected git\\n' >> "$PROBE_LOG"; return 99; }
  `
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-u', '-o', 'pipefail', '-c',
    [mocks, validateTag.run, configureAuth.run, publishSnapshot.run].join('\n')], {
    cwd: root,
    env: { PATH: '/usr/bin:/bin', HOME: root, TAG: tag, NPM_TOKEN: 'synthetic-registry-token',
      PROBE_LOG: log, SNAPSHOT_EXIT: String(snapshotExit), PUBLISH_EXIT: String(publishExit) },
    encoding: 'utf8', timeout: 5000,
  })
  assert.equal(result.error, undefined)
  const calls = await readFile(log, 'utf8').then(text => text.trimEnd().split('\n').filter(Boolean)
    .map(line => line.split('\0').filter(Boolean)), error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  const auth = await readFile(join(root, '.npmrc'), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return undefined
    throw error
  })
  const injection = await stat(join(root, 'injected')).then(() => true, error => {
    if (error.code === 'ENOENT') return false
    throw error
  })
  return { ...result, calls, auth, injection }
}

for (const tag of ['canary', 'beta', 'rc']) {
  test(`mocked ${tag} dispatch authenticates and forwards the exact safe tag with git tagging disabled`, async t => {
    const result = await mockDispatch(t, tag)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(result.calls, [
      ['exec', 'changeset', 'version', '--snapshot', tag],
      ['exec', 'changeset', 'publish', '--tag', tag, '--no-git-tag'],
    ])
    assert.equal(result.auth, '//registry.npmjs.org/:_authToken=synthetic-registry-token\n'
      + 'registry=https://registry.npmjs.org/\n@dsh-next:registry=https://registry.npmjs.org/\n')
    assert.equal(result.injection, false)
  })
}

test('invalid API tags fail before auth or snapshot/publish and cannot inject shell commands', async t => {
  for (const tag of ['', 'latest', 'next', 'CANARY', ' canary', 'canary ', 'canary\nbeta', '--tag=latest',
    'canary; printf injected > "$HOME/injected"', '$(printf injected > "$HOME/injected")',
    'canary"; printf injected > "$HOME/injected"; #', '`printf injected > "$HOME/injected"`']) {
    const result = await mockDispatch(t, tag)
    assert.equal(result.status, 1, JSON.stringify(tag))
    assert.match(result.stderr, /Invalid prerelease tag/)
    assert.deepEqual(result.calls, [])
    assert.equal(result.auth, undefined)
    assert.equal(result.injection, false)
  }
})

test('a failing mocked snapshot never proceeds to publish', async t => {
  const result = await mockDispatch(t, 'rc', { snapshotExit: 17 })
  assert.equal(result.status, 17)
  assert.deepEqual(result.calls, [['exec', 'changeset', 'version', '--snapshot', 'rc']])
})

test('a failing mocked publish retains its nonzero status instead of reporting success', async t => {
  const result = await mockDispatch(t, 'beta', { publishExit: 23 })
  assert.equal(result.status, 23)
  assert.deepEqual(result.calls, [
    ['exec', 'changeset', 'version', '--snapshot', 'beta'],
    ['exec', 'changeset', 'publish', '--tag', 'beta', '--no-git-tag'],
  ])
})
