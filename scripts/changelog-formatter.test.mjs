/**
 * Tests for the changesets changelog formatter (.changeset/changelog.mjs).
 *
 * The formatter renders change-file summaries into changelog bullets and
 * appends a linked GitHub attribution for the author of the pull request that
 * introduced the change file. The GitHub lookup is exercised through an
 * injectable fetch so every branch is covered without network: resolved
 * author, no associated PR (direct push to main), missing GITHUB_TOKEN /
 * commit / repo option, API failure, and multi-line summaries. Runs in the
 * root `pnpm test:scripts` lane (the repo runs `node --test
 * scripts/*.test.mjs`).
 */
import { afterEach, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import formatter, { findPrAuthor, resolveAttribution } from '../.changeset/changelog.mjs'

const { getReleaseLine, getDependencyReleaseLine } = formatter

const OPTS = { repo: 'dsh-next/dsh-next-plugins' }
const CHANGESET = { summary: 'Fixed notification title truncation.', commit: 'a1b2c3d' }

// The formatter reads the token from the environment at call time; keep tests
// deterministic regardless of the host environment.
const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN
beforeEach(() => {
  delete process.env.GITHUB_TOKEN
})
afterEach(() => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.GITHUB_TOKEN
  else process.env.GITHUB_TOKEN = ORIGINAL_TOKEN
})

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

const prAuthorFetch = (login) => jsonResponse([{ user: { login } }])

// A fetch that records calls and fails the test if invoked.
function forbiddenFetch() {
  throw new Error('fetch must not be called for this case')
}

// Patch the global fetch that the formatter falls back to by default; the
// injected seam cannot reach getReleaseLine, which takes no fetchImpl.
function withGlobalFetch(impl, run) {
  const original = globalThis.fetch
  globalThis.fetch = impl
  try {
    return run()
  } finally {
    globalThis.fetch = original
  }
}

describe('getReleaseLine formatting', () => {
  it('renders a single-line summary as a plain bullet', async () => {
    assert.equal(
      await getReleaseLine(CHANGESET, 'patch', OPTS),
      '- Fixed notification title truncation.',
    )
  })

  it('indents continuation lines of a multi-line summary', async () => {
    const changeset = {
      summary: 'First line.\nSecond line.  \nThird line.',
      commit: 'a1b2c3d',
    }
    assert.equal(
      await getReleaseLine(changeset, 'patch', OPTS),
      '- First line.\n  Second line.\n  Third line.',
    )
  })

  it('appends a linked attribution for the PR author when resolvable', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    const line = await withGlobalFetch(
      () => prAuthorFetch('octocat'),
      () => getReleaseLine(CHANGESET, 'patch', OPTS),
    )
    assert.equal(
      line,
      '- Fixed notification title truncation. ([@octocat](https://github.com/octocat))',
    )
  })

  it('keeps the attribution on the first line of a multi-line summary', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    const changeset = { summary: 'First line.\nSecond line.', commit: 'a1b2c3d' }
    const line = await withGlobalFetch(
      () => prAuthorFetch('octocat'),
      () => getReleaseLine(changeset, 'patch', OPTS),
    )
    assert.equal(
      line,
      '- First line. ([@octocat](https://github.com/octocat))\n  Second line.',
    )
  })

  it('omits the attribution when the GitHub API errors', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    const line = await withGlobalFetch(
      () => jsonResponse({ message: 'rate limited' }, 403),
      () => getReleaseLine(CHANGESET, 'patch', OPTS),
    )
    assert.equal(line, '- Fixed notification title truncation.')
  })

  it('omits the attribution for a change file with no associated PR', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    const line = await withGlobalFetch(
      () => jsonResponse([]),
      () => getReleaseLine(CHANGESET, 'patch', OPTS),
    )
    assert.equal(line, '- Fixed notification title truncation.')
  })
})

describe('resolveAttribution guards', () => {
  it('returns null without a network call when GITHUB_TOKEN is unset', async () => {
    const changeset = { ...CHANGESET }
    assert.equal(await resolveAttribution(changeset, OPTS, forbiddenFetch), null)
  })

  it('returns null without a network call when the repo option is missing', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    assert.equal(await resolveAttribution(CHANGESET, {}, forbiddenFetch), null)
    assert.equal(await resolveAttribution(CHANGESET, undefined, forbiddenFetch), null)
  })

  it('returns null without a network call when the changeset carries no commit', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    assert.equal(
      await resolveAttribution({ summary: 'x', commit: undefined }, OPTS, forbiddenFetch),
      null,
    )
    assert.equal(await resolveAttribution({ summary: 'x' }, OPTS, forbiddenFetch), null)
  })
})

describe('resolveAttribution lookup', () => {
  it('requests the commit PRs endpoint with bearer auth and returns the linked login', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    const calls = []
    const login = await resolveAttribution(
      CHANGESET,
      OPTS,
      async (url, init) => {
        calls.push({ url, init })
        return prAuthorFetch('octocat')
      },
    )
    assert.equal(login, '([@octocat](https://github.com/octocat))')
    assert.equal(calls.length, 1)
    assert.equal(
      calls[0].url,
      'https://api.github.com/repos/dsh-next/dsh-next-plugins/commits/a1b2c3d/pulls',
    )
    assert.equal(calls[0].init.headers.Authorization, 'Bearer test-token')
    assert.equal(calls[0].init.headers.Accept, 'application/vnd.github+json')
    assert.equal(calls[0].init.headers['X-GitHub-Api-Version'], '2022-11-28')
  })

  it('returns null when the commit has no associated pull request', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    assert.equal(await resolveAttribution(CHANGESET, OPTS, () => jsonResponse([])), null)
  })

  it('returns null for malformed API payloads', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    assert.equal(
      await resolveAttribution(CHANGESET, OPTS, () => jsonResponse([{ user: {} }])),
      null,
    )
    assert.equal(
      await resolveAttribution(CHANGESET, OPTS, () => jsonResponse([{ user: { login: '' } }])),
      null,
    )
    assert.equal(await resolveAttribution(CHANGESET, OPTS, () => jsonResponse(null)), null)
    assert.equal(await resolveAttribution(CHANGESET, OPTS, () => jsonResponse('not array')), null)
  })

  it('swallows transport and HTTP errors as no attribution', async () => {
    process.env.GITHUB_TOKEN = 'test-token'
    assert.equal(
      await resolveAttribution(CHANGESET, OPTS, () => jsonResponse({}, 404)),
      null,
    )
    assert.equal(
      await resolveAttribution(CHANGESET, OPTS, async () => {
        throw new Error('network down')
      }),
      null,
    )
  })
})

describe('findPrAuthor', () => {
  it('returns the first PR author login', async () => {
    const login = await findPrAuthor({
      repo: 'dsh-next/dsh-next-plugins',
      commit: 'a1b2c3d',
      token: 'test-token',
      fetchImpl: () =>
        jsonResponse([{ user: { login: 'first' } }, { user: { login: 'second' } }]),
    })
    assert.equal(login, 'first')
  })

  it('returns null when no PR is associated', async () => {
    const login = await findPrAuthor({
      repo: 'dsh-next/dsh-next-plugins',
      commit: 'a1b2c3d',
      token: 'test-token',
      fetchImpl: () => jsonResponse([]),
    })
    assert.equal(login, null)
  })

  it('throws on non-2xx responses so callers can degrade', async () => {
    await assert.rejects(
      findPrAuthor({
        repo: 'dsh-next/dsh-next-plugins',
        commit: 'a1b2c3d',
        token: 'test-token',
        fetchImpl: () => jsonResponse({}, 500),
      }),
      /GitHub API responded 500/,
    )
  })
})

describe('getDependencyReleaseLine', () => {
  it('returns an empty string when no dependencies were updated', () => {
    assert.equal(getDependencyReleaseLine([CHANGESET], [], OPTS), '')
  })

  it('lists updated dependency versions without hashes', () => {
    assert.equal(
      getDependencyReleaseLine(
        [CHANGESET],
        [{ name: '@dsh-next/dsh-next-notifier', newVersion: '0.2.1' }],
        OPTS,
      ),
      '- Updated dependencies\n  - @dsh-next/dsh-next-notifier@0.2.1',
    )
  })
})
