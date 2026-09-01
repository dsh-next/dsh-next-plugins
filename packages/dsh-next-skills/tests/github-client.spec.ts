import { describe, expect, it } from 'vitest'
import { fetchRepoInfo, fetchRepoTarball } from '../src/host/github-client.ts'
import { createGhDouble } from './helpers/gh.ts'

describe('fetchRepoInfo', () => {
  it('resolves the description and stars', async () => {
    const gh = createGhDouble({ repoDescription: 'Skills collection', repoStars: 7 })
    expect(await fetchRepoInfo(gh.fetch, 'o', 'r')).toEqual({
      owner: 'o', repo: 'r', description: 'Skills collection', stars: 7,
    })
  })
  it('explains a missing repository', async () => {
    const gh = createGhDouble({ repoStatus: 404 })
    await expect(fetchRepoInfo(gh.fetch, 'o', 'r')).rejects.toThrow(/repository not found/)
  })
  it('explains a rejected request (private repository)', async () => {
    const gh = createGhDouble({ repoStatus: 401 })
    await expect(fetchRepoInfo(gh.fetch, 'o', 'r')).rejects.toThrow(/private/)
  })
  it('explains rate limits', async () => {
    const gh = createGhDouble({ repoStatus: 403 })
    await expect(fetchRepoInfo(gh.fetch, 'o', 'r')).rejects.toThrow(/rate limit/)
  })
  it('sends an Authorization header when GITHUB_TOKEN is set', async () => {
    process.env.GITHUB_TOKEN = 'tok-123'
    try {
      const gh = createGhDouble()
      await fetchRepoInfo(gh.fetch, 'o', 'r')
      expect(gh.calls[0]?.headers?.authorization).toBe('Bearer tok-123')
    } finally {
      delete process.env.GITHUB_TOKEN
    }
  })

  it('prefers DSH_GITHUB_TOKEN when both token variables are set', async () => {
    process.env.GITHUB_TOKEN = 'generic'
    process.env.DSH_GITHUB_TOKEN = 'dsh-specific'
    try {
      const gh = createGhDouble()
      await fetchRepoInfo(gh.fetch, 'o', 'r')
      expect(gh.calls[0]?.headers?.authorization).toBe('Bearer dsh-specific')
    } finally {
      delete process.env.GITHUB_TOKEN
      delete process.env.DSH_GITHUB_TOKEN
    }
  })

  it('omits the Authorization header without a token', async () => {
    delete process.env.GITHUB_TOKEN
    delete process.env.DSH_GITHUB_TOKEN
    const gh = createGhDouble()
    await fetchRepoInfo(gh.fetch, 'o', 'r')
    expect(gh.calls[0]?.headers?.authorization).toBeUndefined()
  })

  it('sends the API metadata headers', async () => {
    const gh = createGhDouble()
    await fetchRepoInfo(gh.fetch, 'o', 'r')
    expect(gh.calls[0]?.headers?.['user-agent']).toBe('dsh-next-skills')
    expect(gh.calls[0]?.headers?.accept).toBe('application/vnd.github+json')
  })
})

describe('fetchRepoTarball', () => {
  it('downloads the default-branch snapshot as bytes', async () => {
    const gh = createGhDouble({ files: { 'skills/x/SKILL.md': '---\nname: x\n---\n' } })
    const bytes = await fetchRepoTarball(gh.fetch, 'o', 'r')
    expect(bytes.length).toBeGreaterThan(100) // a real gzip payload
    expect(gh.snapshotCalls()).toBe(1)
    expect(gh.calls[0]?.url).toBe('https://codeload.github.com/o/r/tar.gz/HEAD')
    expect(gh.calls[0]?.headers?.['user-agent']).toBe('dsh-next-skills')
  })
  it('explains a missing repository', async () => {
    const gh = createGhDouble({ tarballStatus: 404 })
    await expect(fetchRepoTarball(gh.fetch, 'o', 'r')).rejects.toThrow(/repository not found/)
  })
})
