import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { parse } from 'yaml'
import {
  fetchContributors, renderContributors, runCli, synchronizeContributors, updateReadme,
} from './update-contributors.mjs'

const START = '<!-- contributors:start -->'
const END = '<!-- contributors:end -->'
const metadata = { repository: 'fixture-owner/fixture-repo', token: 'fixture_secret_token' }
const user = (login, contributions = 1, extra = {}) => ({ login, contributions, type: 'User', ...extra })
const response = (payload, status = 200) => ({ status, json: async () => payload })
const blankReadme = '# Fixture\n\nKeep this content.\n\n## License\n\nMIT.\n'
const fullPage = Array.from({ length: 100 }, (_, index) => user(`user-${index}`))

function pageFixture(...responses) {
  const calls = []
  return {
    calls,
    fetchImpl: async (url, options) => {
      calls.push({ url, options })
      assert.ok(responses.length, 'unexpected additional API page')
      return responses.shift()
    },
  }
}

function fileFixture(initial) {
  let content = initial
  const reads = []
  const writes = []
  return {
    reads, writes,
    content: () => content,
    read: async (path, encoding) => {
      reads.push({ path, encoding })
      return content
    },
    write: async (path, next, encoding) => {
      writes.push({ path, encoding })
      content = next
    },
  }
}

test('renderer canonicalizes, deduplicates by maximum count, and sorts deterministically without mutation', () => {
  const input = [user('Zed', 5), user('Alice', 4), user('alice', 9), user('bob', 9), user('Zero', 0)]
    .map(Object.freeze)
  Object.freeze(input)
  const expected = '- [@alice](https://github.com/alice)\n- [@bob](https://github.com/bob)\n'
    + '- [@zed](https://github.com/zed)\n- [@zero](https://github.com/zero)'
  assert.equal(renderContributors(input), expected)
  assert.equal(renderContributors([...input].reverse()), expected)
  assert.equal(renderContributors([user('alice', 9), user('Alice', 4)]), '- [@alice](https://github.com/alice)')
})

test('renderer derives GitHub profiles and excludes bots by both type and suffix', () => {
  const rendered = renderContributors([
    user('Safe-Login', 1, { name: '<script>credential</script>', html_url: 'https://evil.test/credential', email: 'credential' }),
    user('automation', 99, { type: 'Bot' }), user('dependabot[bot]', 99),
  ])
  assert.equal(rendered, '- [@safe-login](https://github.com/safe-login)')
  assert.equal(renderContributors([]), 'No human contributors were returned by GitHub.')
  assert.equal(renderContributors([user('github-actions[bot]', 2, { type: 'Bot' })]), renderContributors([]))
})

test('renderer rejects every malformed schema/login branch, including malformed bot records', () => {
  for (const input of [null, {}, 'credential']) assert.throws(() => renderContributors(input), /must be an array/)
  for (const record of [null, [], {}, user('x', -1), user('x', 1.2), user('x', Number.MAX_SAFE_INTEGER + 1),
    user('x', '1'), user('x', 1, { type: 'Organization' }), user(1), user('x', 1, { type: undefined })]) {
    assert.throws(() => renderContributors([record]), /invalid record/)
  }
  for (const login of ['', '-x', 'x-', 'x--y', 'x_y', 'x/y', '[x](https://evil.test)', 'x\ncredential',
    'alice\n', 'alice\r', 'alice\u2028', 'alice\u2029', '\u212Aelvin', 'a'.repeat(40)]) {
    assert.throws(() => renderContributors([user(login)]), /invalid GitHub login/)
  }
  assert.throws(() => renderContributors([user('bad_bot[bot]', 1, { type: 'Bot' })]), /invalid GitHub login/)
  assert.equal(renderContributors([user('a'.repeat(39))]), `- [@${'a'.repeat(39)}](https://github.com/${'a'.repeat(39)})`)
})

test('update seam replaces only the exact marker block and is idempotent', () => {
  const prefix = '# Fixture\n\nNon-generated text with trailing spaces.  \n'
  const suffix = '\n\n## License\n\nMIT without a final newline'
  const current = `${prefix}${START}\nOld list.\n${END}${suffix}`
  const updated = updateReadme(current, [user('alice')])
  assert.equal(updated, `${prefix}${START}\n${renderContributors([user('alice')])}\n${END}${suffix}`)
  assert.equal(updateReadme(updated, [user('alice')]), updated)
  assert.equal(updateReadme(updated, []), `${prefix}${START}\n${renderContributors([])}\n${END}${suffix}`)
})

test('update seam preserves CRLF and a closing marker at end-of-file', () => {
  const prefix = '# Fixture\r\n'
  const current = `${prefix}${START}\r\nOld list\r\n${END}`
  const rendered = renderContributors([user('alice'), user('bob')]).replaceAll('\n', '\r\n')
  assert.equal(updateReadme(current, [user('bob'), user('alice')]), `${prefix}${START}\r\n${rendered}\r\n${END}`)
  assert.equal(updateReadme(`${START}\nold\n${END}`, []), `${START}\n${renderContributors([])}\n${END}`)
})

test('update seam inserts an intentional Contributors section before License without deleting bytes', () => {
  const updated = updateReadme(blankReadme, [])
  assert.equal(updated, blankReadme.replace('## License', `## Contributors\n\n${START}\n${renderContributors([])}\n${END}\n\n## License`))
  const existing = '# Fixture\n\n## Contributors\n\nKeep this acknowledgment.\n\n## Other\n\nKeep this too.\n\n## License\nMIT.'
  const withBlock = updateReadme(existing, [])
  assert.equal(withBlock, existing.replace('## Other', `${START}\n${renderContributors([])}\n${END}\n\n## Other`))
  for (const prefix of ['# Fixture\n', '# Fixture']) {
    // A License heading must start on its own line; the second fixture has no extra blank line.
    const source = `${prefix}\n## License\nMIT.`
    assert.ok(updateReadme(source, []).endsWith('## License\nMIT.'))
  }
  const crlf = blankReadme.replaceAll('\n', '\r\n')
  assert.equal(updateReadme(crlf, []), updated.replaceAll('\n', '\r\n'))
})

test('update seam ignores fenced examples as insertion targets and supports a License-only README', () => {
  const example = '# Fixture\n\n```markdown\n## Contributors\n~~~\n## License\n```not-a-close\n## License\n````\n\n'
  const source = `${example}## License\nMIT.`
  assert.equal(updateReadme(source, []), `${example}## Contributors\n\n${START}\n${renderContributors([])}\n${END}\n\n## License\nMIT.`)
  assert.throws(() => updateReadme(example, []), /one License section/)
  assert.throws(() => updateReadme('~~~markdown\n## License\n~~~\n', []), /one License section/)
  assert.throws(() => updateReadme('```markdown\n## License\n', []), /one License section/)
  assert.ok(updateReadme('## License\nMIT.', []).startsWith('## Contributors\n'))
})

test('update seam fails closed on partial, duplicate, reversed, or inline exact markers', () => {
  for (const current of [START, END, `${END}\n${START}`, `${START}\n${START}\n${END}`,
    `${START}\n${END}\n${END}`, `prose ${START}\n${END}`, `${START} prose\n${END}`,
    `${START}\nprose ${END}`, `${START}\n${END} prose`]) {
    assert.throws(() => updateReadme(current, []), /one ordered, standalone pair/)
  }
  for (const current of ['# No License', '## License\n\n## License', '## License\n\n## Contributors',
    '## Contributors\n\n## Contributors\n\n## License']) {
    assert.throws(() => updateReadme(current, []), /one License section/)
  }
  assert.throws(() => updateReadme(null, []), /must contain text/)
})

test('fetch uses normal metadata, a fixed GitHub endpoint, bearer headers, and stops on a short page', async () => {
  const fixture = pageFixture(response([user('Alice', 2)]))
  assert.deepEqual(await fetchContributors({ ...metadata, ...fixture }), [user('alice', 2)])
  assert.equal(fixture.calls.length, 1)
  assert.equal(fixture.calls[0].url, 'https://api.github.com/repos/fixture-owner/fixture-repo/contributors?per_page=100&page=1')
  assert.deepEqual(fixture.calls[0].options.headers, {
    Authorization: `Bearer ${metadata.token}`, Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'dsh-next-plugins-contributor-sync',
  })
  assert.equal(fixture.calls[0].options.redirect, 'error')
  assert.equal(fixture.calls[0].options.signal.aborted, false)
})

test('fetch paginates by raw page size, ignores Link URLs, and deduplicates across pages', async () => {
  const first = response(fullPage)
  first.headers = { get: () => '<https://evil.test/credential>; rel="next"' }
  const fixture = pageFixture(first, response([user('USER-0', 10), user('alice', 3)]))
  const users = await fetchContributors({ ...metadata, ...fixture })
  assert.equal(users.length, 101)
  assert.deepEqual(users.slice(0, 2), [user('user-0', 10), user('alice', 3)])
  assert.ok(fixture.calls[1].url.endsWith('&page=2'))
  const bots = pageFixture(response(fullPage.map(record => ({ ...record, type: 'Bot' }))), response([user('human')]))
  assert.deepEqual(await fetchContributors({ ...metadata, ...bots }), [user('human')])
  assert.equal(bots.calls.length, 2)
})

test('fetch handles empty arrays and HTTP 204 without attempting JSON parsing', async () => {
  for (const status of [200, 204]) {
    const fixture = pageFixture(status === 200 ? response([]) : { status, json: () => assert.fail('204 has no body') })
    assert.deepEqual(await fetchContributors({ ...metadata, ...fixture }), [])
  }
  const fixture = pageFixture(response(fullPage), { status: 204 })
  assert.equal((await fetchContributors({ ...metadata, ...fixture })).length, 100)
})

test('fetch fails rather than rendering a truncated or oversized page', async () => {
  const fixture = pageFixture(response(fullPage))
  await assert.rejects(fetchContributors({ ...metadata, ...fixture, maxPages: 1 }), /pagination limit reached/)
  assert.equal(fixture.calls.length, 1)
  const capped = pageFixture(...Array.from({ length: 10 }, () => response(fullPage)))
  await assert.rejects(fetchContributors({ ...metadata, ...capped }), /pagination limit reached/)
  assert.equal(capped.calls.length, 10)
  await assert.rejects(fetchContributors({ ...metadata, ...pageFixture(response([...fullPage, user('extra')])) }), /page size/)
})

test('fetch rejects error statuses without reading credential-bearing bodies', async () => {
  for (const status of [201, 301, 401, 403, 429, 500]) {
    await assert.rejects(fetchContributors({ ...metadata, fetchImpl: async () => ({
      status, json: () => assert.fail(`must not read an error body for HTTP ${status}`),
    }) }), new RegExp(`HTTP ${status}`))
  }
  for (const invalid of [null, {}, { status: '200' }, { status: 99 }, { status: 600 }]) {
    await assert.rejects(fetchContributors({ ...metadata, fetchImpl: async () => invalid }), /invalid response/)
  }
})

test('fetch validates JSON and every contributor page and sanitizes transport errors', async () => {
  await assert.rejects(fetchContributors({ ...metadata, fetchImpl: async () => {
    throw new Error(metadata.token)
  } }), { message: 'GitHub contributors API request failed' })
  await assert.rejects(fetchContributors({ ...metadata, fetchImpl: async () => ({ status: 200, json: async () => {
    throw new Error(metadata.token)
  } }) }), { message: 'GitHub contributors API returned invalid JSON' })
  await assert.rejects(fetchContributors({ ...metadata, ...pageFixture(response({ message: metadata.token })) }), /must be an array/)
  await assert.rejects(fetchContributors({ ...metadata, ...pageFixture(response(fullPage), response([user('x/y')])) }), /invalid GitHub login/)
  await assert.rejects(fetchContributors({ ...metadata, ...pageFixture(response([{}])) }), /invalid record/)
})

test('fetch timeouts cover stalled requests and stalled JSON and abort the request signal', async () => {
  for (const stallBody of [false, true]) {
    let signal
    const fetchImpl = async (_url, options) => {
      signal = options.signal
      const stalled = new Promise(() => {})
      return stallBody ? { status: 200, json: () => stalled } : stalled
    }
    await assert.rejects(fetchContributors({ ...metadata, fetchImpl, timeoutMs: 5 }), /timed out/)
    assert.equal(signal.aborted, true)
  }
})

test('fetch rejects unsafe metadata and out-of-bounds configuration before requesting anything', async () => {
  const fetchImpl = () => assert.fail('invalid configuration must not request a page')
  for (const repository of [undefined, '', 'owner', 'owner/repo/extra', '-owner/repo', 'owner--name/repo',
    'owner/..', 'owner/.', 'owner/a?token=credential', 'owner/repo\n', 'owner/repo\r', 'owner/repo\u2028',
    'owner\n/repo', `${'a'.repeat(40)}/repo`]) {
    await assert.rejects(fetchContributors({ ...metadata, repository, fetchImpl }), /GITHUB_REPOSITORY/)
  }
  for (const token of [undefined, '', ' \t', 'secret\ncredential', 1]) {
    await assert.rejects(fetchContributors({ ...metadata, token, fetchImpl }), /GITHUB_TOKEN/)
  }
  for (const overrides of [{ fetchImpl: null }, { maxPages: 0 }, { maxPages: 11 }, { maxPages: 1.2 },
    { timeoutMs: 0 }, { timeoutMs: 30_001 }, { timeoutMs: 1.2 }]) {
    await assert.rejects(fetchContributors({ ...metadata, fetchImpl, ...overrides }), /1-10 pages/)
  }
  await assert.rejects(fetchContributors(), /GITHUB_REPOSITORY/)
})

test('synchronization reads the root README and conditionally writes without changing other bytes', async () => {
  const files = fileFixture(blankReadme)
  const options = { ...metadata, ...files, fetchImpl: async () => response([user('Alice'), user('automation', 9, { type: 'Bot' })]) }
  assert.deepEqual(await synchronizeContributors(options), { changed: true, count: 1 })
  assert.equal(files.content(), updateReadme(blankReadme, [user('alice')]))
  assert.equal(files.writes.length, 1)
  assert.equal(files.reads[0].encoding, 'utf8')
  assert.equal(files.reads[0].path.href, new URL('../README.md', import.meta.url).href)
  assert.equal(files.writes[0].path, files.reads[0].path)
  assert.deepEqual(await synchronizeContributors(options), { changed: false, count: 1 })
  assert.equal(files.writes.length, 1, 'a no-op must not rewrite the file')
})

test('synchronization does not write on invalid metadata, malformed markers, fetch failure, or read failure', async () => {
  await assert.rejects(synchronizeContributors(), /GITHUB_REPOSITORY/)
  const readFailure = fileFixture(blankReadme)
  await assert.rejects(synchronizeContributors({ ...metadata, ...readFailure,
    read: async () => { throw new Error(metadata.token) }, fetchImpl: () => assert.fail('do not fetch after a read failure'),
  }), { message: 'Could not read root README' })
  assert.equal(readFailure.writes.length, 0)
  for (const initial of [START, `${END}\n${START}`]) {
    const files = fileFixture(initial)
    await assert.rejects(synchronizeContributors({ ...metadata, ...files, fetchImpl: async () => response([]) }), /marker/)
    assert.equal(files.content(), initial)
    assert.equal(files.writes.length, 0)
  }
  const files = fileFixture(blankReadme)
  await assert.rejects(synchronizeContributors({ ...metadata, ...files, fetchImpl: async () => response({}, 403) }), /HTTP 403/)
  assert.equal(files.writes.length, 0)
  assert.equal(files.content(), blankReadme)
})

test('synchronization reports credential-safe write errors', async () => {
  const files = fileFixture(blankReadme)
  await assert.rejects(synchronizeContributors({ ...metadata, ...files, fetchImpl: async () => response([]),
    write: async () => { throw new Error(metadata.token) },
  }), { message: 'Could not write root README' })
  assert.equal(files.content(), blankReadme)
})

test('CLI seam reports real changed/no-op counts using standard environment metadata', async () => {
  const logs = []
  const files = fileFixture(blankReadme)
  const options = {
    env: { GITHUB_REPOSITORY: metadata.repository, GITHUB_TOKEN: metadata.token },
    ...files, fetchImpl: async () => response([user('alice')]), log: message => logs.push(message),
    error: () => assert.fail('successful CLI must not report errors'),
  }
  assert.equal(await runCli(options), 0)
  assert.equal(await runCli(options), 0)
  assert.deepEqual(logs, [
    'update-contributors: root README updated (1 human contributors; bots excluded)',
    'update-contributors: root README unchanged (1 human contributors; bots excluded)',
  ])
})

test('CLI seam returns configuration/service exit codes and never logs tokens, bodies, or raw exceptions', async () => {
  const errors = []
  const base = {
    env: { GITHUB_REPOSITORY: metadata.repository, GITHUB_TOKEN: metadata.token },
    ...fileFixture(blankReadme), error: message => errors.push(message), log: () => assert.fail('failed CLI must not log success'),
  }
  assert.equal(await runCli({ ...base, env: {} }), 2)
  assert.equal(await runCli({ ...base, env: { GITHUB_REPOSITORY: metadata.repository } }), 2)
  assert.equal(await runCli({ ...base, fetchImpl: async () => { throw new Error(metadata.token) } }), 1)
  assert.equal(await runCli({ ...base, fetchImpl: async () => ({ status: 403, json: () => { throw new Error(metadata.token) } }) }), 1)
  assert.equal(await runCli({ ...base, fetchImpl: async () => response([{ login: metadata.token, name: metadata.token }]) }), 1)
  assert.equal(await runCli({ ...base, fetchImpl: async () => response([]), log: () => { throw new Error(metadata.token) } }), 1)
  assert.ok(errors.some(message => message.includes('HTTP 403')))
  assert.ok(errors.some(message => message.endsWith('Synchronization failed')))
  for (const message of errors) assert.ok(!message.includes(metadata.token), 'secret must not reach a diagnostic')
})

test('workflow serializes its main-targeted bot PR without bypassing branch protection', async () => {
  const yaml = await readFile(new URL('../.github/workflows/contributors.yml', import.meta.url), 'utf8')
  const workflow = parse(yaml)
  assert.equal(workflow.permissions.contents, 'write')
  assert.equal(workflow.concurrency.group, 'contributors-${{ github.repository }}-main')
  assert.equal(workflow.concurrency['cancel-in-progress'], false)
  const steps = workflow.jobs['update-contributors'].steps
  const checkout = steps.find(step => step.uses?.startsWith('actions/checkout@'))
  assert.equal(checkout.with.ref, 'main')
  assert.equal(checkout.with['persist-credentials'], true)
  assert.equal(workflow.permissions['pull-requests'], 'write')
  const generate = steps.find(step => step.run?.includes('node scripts/update-contributors.mjs'))
  assert.deepEqual(generate.env, { GITHUB_REPOSITORY: '${{ github.repository }}', GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}' })
  const commit = steps.find(step => step.run?.includes('git commit'))
  assert.match(commit.run, /git diff --quiet -- README\.md/)
  assert.match(commit.run, /git add README\.md/)
  assert.match(commit.run, /git switch -C automation\/contributors/)
  assert.match(commit.run, /git push --force-with-lease origin HEAD:refs\/heads\/automation\/contributors/)
  assert.match(commit.run, /gh pr create --base main/)
  assert.equal(commit.env.GH_TOKEN, '${{ github.token }}')
  assert.doesNotMatch(commit.run, /git push origin HEAD:main|git pull --rebase|--force /)
  assert.doesNotMatch(yaml, /github\.ref|PAT|APP_TOKEN|pnpm install|npm install|READMEs/)
})

test('actual contributor proposal shell uses mocks only and stops after errors/no change', async () => {
  const workflow = parse(await readFile(new URL('../.github/workflows/contributors.yml', import.meta.url), 'utf8'))
  const step = workflow.jobs['update-contributors'].steps.find(item => item.name === 'Propose contributor update if changed')
  const mocks = `
    git() {
      printf 'MOCK git: %s\\n' "$*" >&2
      if [ "$1" = diff ]; then [ "$MOCK_CHANGED" = no ]; return; fi
      if [ "$1" = push ] && [ "$MOCK_PUSH_FAIL" = yes ]; then return 1; fi
      return 0
    }
    gh() {
      printf 'MOCK gh: %s\\n' "$*" >&2
      if [ "$1 $2" = 'pr list' ]; then printf '%s' "$MOCK_PR"; fi
      return 0
    }
  `
  const run = options => spawnSync('bash', ['-c', mocks + '\n' + step.run], {
    encoding: 'utf8', env: { PATH: process.env.PATH, MOCK_CHANGED: 'yes', MOCK_PUSH_FAIL: 'no', MOCK_PR: '', ...options },
  })
  const fresh = run({})
  assert.equal(fresh.status, 0, fresh.stderr)
  assert.match(fresh.stderr, /MOCK gh: pr create --base main --head automation\/contributors/)
  assert.doesNotMatch(fresh.stderr, /HEAD:main/)
  const existing = run({ MOCK_PR: '123' })
  assert.equal(existing.status, 0)
  assert.doesNotMatch(existing.stderr, /MOCK gh: pr create/)
  assert.match(existing.stdout, /existing contributor PR #123/)
  const unchanged = run({ MOCK_CHANGED: 'no' })
  assert.equal(unchanged.status, 0)
  assert.doesNotMatch(unchanged.stderr, /MOCK git: push|MOCK gh/)
  const failure = run({ MOCK_PUSH_FAIL: 'yes' })
  assert.equal(failure.status, 1)
  assert.doesNotMatch(failure.stderr, /MOCK gh/)
})

test('checked-in root README has one ordered contributor marker block before License', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  assert.equal(readme.split(START).length - 1, 1)
  assert.equal(readme.split(END).length - 1, 1)
  assert.ok(readme.indexOf('## Contributors') < readme.indexOf(START))
  assert.ok(readme.indexOf(START) < readme.indexOf(END))
  assert.ok(readme.indexOf(END) < readme.indexOf('## License'))
})
