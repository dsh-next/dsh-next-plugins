import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import YAML from 'yaml'
import { PR_TYPES, LATEST_TARGET_CONFIRMATION, validatePrContribution, enforcePrContribution } from './github-pr-contribution.mjs'

const template = readFileSync(new URL('../.github/pull_request_template.md', import.meta.url), 'utf8')
const workflow = YAML.parse(readFileSync(new URL('../.github/workflows/pr-contribution-rules.yml', import.meta.url), 'utf8'))
const human = body => ({ number: 123, user: { type: 'User', login: 'contributor' }, body })
const body = (type = PR_TYPES[0], validation = '```sh\npnpm run ci\n```\n\nResult summary: All keyless checks passed.') => [
  '## PR Type', '- [x] ' + type, '## Latest Codebase Confirmation', '- [x] ' + LATEST_TARGET_CONFIRMATION, '## Local Validation', validation, '## User-Visible Change Evidence', 'not part of local validation',
].join('\n\n')

test('human evidence matches the actual template and both main/dev target policy', () => {
  assert(template.includes('- [ ] ' + LATEST_TARGET_CONFIRMATION))
  assert(!template.includes('latest `main` branch'))
  for (const type of PR_TYPES) {
    assert(template.includes('- [ ] ' + type))
    assert.deepEqual(validatePrContribution(human(body(type))).errors, [])
  }
  const minimal = body('Maintenance / refactor', 'Commands: None (documentation review only).\n\nResult summary: Not run; no runtime files changed.')
  assert.deepEqual(validatePrContribution(human(minimal)).errors, [])
})

test('bot release PRs are exempt without pretending to have human evidence', () => {
  for (const user of [{ type: 'Bot', login: 'release-app[bot]' }, { type: 'Bot', login: 'github-actions[bot]' }, { login: 'github-actions[bot]' }]) {
    assert.deepEqual(validatePrContribution({ user, body: '' }), { exempt: true, errors: [] })
  }
  assert.equal(validatePrContribution(human('')).exempt, false)
})

test('untouched template and arbitrary checked types fail', () => {
  assert.equal(validatePrContribution(human(template)).errors.length, 3)
  assert(validatePrContribution(human(body('Not a recognized PR type'))).errors.some(error => error.includes('PR Type')))
  assert(validatePrContribution(human(body().replace('- [x] ' + LATEST_TARGET_CONFIRMATION, '- [ ] ' + LATEST_TARGET_CONFIRMATION))).errors.some(error => error.includes('target branch')))
})

test('blank headings never consume the next section as evidence', () => {
  for (const heading of ['PR Type', 'Latest Codebase Confirmation', 'Local Validation']) {
    const blankSection = body().replace(new RegExp('## ' + heading + '\\n\\n[\\s\\S]*?(?=\\n\\n## |$)'), '## ' + heading + '\n\n<!-- fill this in -->')
    assert(validatePrContribution(human(blankSection)).errors.length > 0)
  }
  assert.equal(validatePrContribution({}).errors.length, 3)
  assert.equal(validatePrContribution({ body: 3 }).errors.length, 3)
})

test('local validation needs both commands/reason and a real result, not scaffolding', () => {
  for (const value of ['', 'pnpm run ci', 'Result summary: passed', 'pnpm run ci\nResult summary:', 'pnpm run ci\nResult summary: <!-- evidence -->', 'pnpm run ci\nResult summary: _No response_']) {
    assert(validatePrContribution(human(body(PR_TYPES[1], value))).errors.some(error => error.includes('Local Validation')), value)
  }
  assert.deepEqual(validatePrContribution(human(body().replaceAll('\n', '\r\n'))).errors, [])
})

function mock() {
  const calls = { comments: [], warnings: [], failures: [] }
  return { calls, github: { rest: { issues: { createComment: async args => calls.comments.push(args) } } }, core: {
    warning: message => calls.warnings.push(message), setFailed: message => calls.failures.push(message),
  } }
}
const context = pr => ({ repo: { owner: 'dsh-next', repo: 'plugins' }, payload: { action: 'opened', pull_request: pr } })

test('enforcement stays quiet for absent/draft/bot/valid PRs', async () => {
  const m = mock()
  for (const pr of [undefined, { ...human(''), draft: true }, { ...human(''), user: { type: 'Bot' } }, human(body())]) {
    await enforcePrContribution({ ...m, context: context(pr) })
  }
  assert.deepEqual(m.calls, { comments: [], warnings: [], failures: [] })
})

test('invalid evidence fails even when the comment API fails; synchronize does not spam', async () => {
  const m = mock()
  await enforcePrContribution({ ...m, context: context(human('')) })
  assert.equal(m.calls.comments.length, 1)
  assert.equal(m.calls.comments[0].issue_number, 123)
  assert.equal(m.calls.failures.length, 1)
  await enforcePrContribution({ ...m, context: { ...context(human('')), payload: { action: 'synchronize', pull_request: human('') } } })
  assert.equal(m.calls.comments.length, 1)
  assert.equal(m.calls.failures.length, 2)
  m.github.rest.issues.createComment = async () => { throw new Error('API unavailable') }
  await enforcePrContribution({ ...m, context: context(human('')) })
  assert.equal(m.calls.warnings.length, 1)
  assert.equal(m.calls.failures.length, 3)
})

test('privileged PR workflow checks out only immutable trusted base and uses absolute module path', () => {
  assert(workflow.on.pull_request_target.types.includes('edited'))
  assert.equal(workflow.permissions.contents, 'read')
  const steps = workflow.jobs.enforce.steps
  assert.equal(steps[0].with.ref, '${{ github.event.pull_request.base.sha }}')
  assert.equal(steps[0].with['persist-credentials'], false)
  assert(steps[1].with.script.includes('process.env.GITHUB_WORKSPACE'))
  assert(steps[1].with.script.includes('/scripts/github-pr-contribution.mjs'))
  assert(!JSON.stringify(steps).includes('head.sha'))
  assert(!steps[1].with.script.includes('${{'))
})
