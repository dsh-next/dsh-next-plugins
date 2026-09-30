#!/usr/bin/env node
/** Synchronize only the root README contributor block; importing has no side effects. */
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const START = '<!-- contributors:start -->'
const END = '<!-- contributors:end -->'
const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i
const MAX_PAGES = 10
const PER_PAGE = 100

// Only these deliberate, value-free diagnostics may reach CLI logs.
class SyncError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.exitCode = exitCode
  }
}

function validateMetadata(repository, token) {
  const parts = typeof repository === 'string' ? repository.split('/') : []
  if (parts.length !== 2 || /\s/.test(repository) || !LOGIN.test(parts[0])
    || !/^[a-z\d_.-]{1,100}$/i.test(parts[1]) || ['.', '..'].includes(parts[1])) {
    throw new SyncError('GITHUB_REPOSITORY must identify a GitHub owner/repository', 2)
  }
  if (typeof token !== 'string' || !token || /\s/.test(token)) {
    throw new SyncError('GITHUB_TOKEN must be a nonempty token without whitespace', 2)
  }
}

function normalizeContributors(contributors) {
  if (!Array.isArray(contributors)) throw new SyncError('Contributor data must be an array')
  const users = new Map()
  for (const contributor of contributors) {
    if (!contributor || typeof contributor !== 'object'
      || typeof contributor.login !== 'string'
      || !['User', 'Bot'].includes(contributor.type)
      || !Number.isSafeInteger(contributor.contributions) || contributor.contributions < 0) {
      throw new SyncError('Contributor data contains an invalid record')
    }
    const rawLogin = contributor.login
    const login = rawLogin.toLowerCase()
    const botSuffix = login.endsWith('[bot]')
    // Validate before case folding, and reject trailing line terminators accepted by regex `$`.
    if (/\s/.test(rawLogin) || !LOGIN.test(botSuffix ? rawLogin.slice(0, -5) : rawLogin)) {
      throw new SyncError('Contributor data contains an invalid GitHub login')
    }
    // Bot type and the conventional suffix both exclude an account. Still validate bots.
    if (contributor.type === 'Bot' || botSuffix) continue
    const previous = users.get(login)
    if (!previous || contributor.contributions > previous.contributions) {
      users.set(login, { login, type: 'User', contributions: contributor.contributions })
    }
  }
  // GitHub logins are case-insensitive. Use ASCII ordering, not the machine's locale.
  return [...users.values()].sort((a, b) => b.contributions - a.contributions
    || (a.login < b.login ? -1 : a.login > b.login ? 1 : 0))
}

/** Render validated login-derived links; names, API URLs, and other fields are never used. */
export function renderContributors(contributors) {
  const users = normalizeContributors(contributors)
  return users.length
    ? users.map(({ login }) => `- [@${login}](https://github.com/${login})`).join('\n')
    : 'No human contributors were returned by GitHub.'
}

function markerIsStandalone(readme, index, marker) {
  const after = readme.slice(index + marker.length)
  return (index === 0 || readme[index - 1] === '\n')
    && (after === '' || after.startsWith('\n') || after.startsWith('\r\n'))
}

function readmeHeadings(readme) {
  const headings = []
  let fence
  for (const line of readme.matchAll(/^.*$/gm)) {
    const text = line[0].replace(/\r$/, '')
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text)
    if (fence) {
      if (delimiter && delimiter[1][0] === fence.character
        && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined
      continue
    }
    if (delimiter) {
      fence = { character: delimiter[1][0], length: delimiter[1].length }
    } else if (text.startsWith('## ')) {
      headings.push({ text, index: line.index })
    }
  }
  return headings
}

/** Preserve all bytes outside a valid marker pair, or insert at the Contributors section. */
export function updateReadme(readme, contributors) {
  if (typeof readme !== 'string') throw new SyncError('Root README must contain text')
  const newline = readme.includes('\r\n') ? '\r\n' : '\n'
  const block = `${START}${newline}${renderContributors(contributors).replaceAll('\n', newline)}${newline}${END}`
  const startCount = readme.split(START).length - 1
  const endCount = readme.split(END).length - 1
  if (startCount || endCount) {
    const start = readme.indexOf(START)
    const end = readme.indexOf(END)
    if (startCount !== 1 || endCount !== 1 || start >= end
      || !markerIsStandalone(readme, start, START) || !markerIsStandalone(readme, end, END)) {
      throw new SyncError('Root README contributor markers must be one ordered, standalone pair')
    }
    return readme.slice(0, start) + block + readme.slice(end + END.length)
  }

  const headings = readmeHeadings(readme)
  const licenses = headings.filter(({ text }) => text === '## License')
  const sections = headings.filter(({ text }) => text === '## Contributors')
  if (licenses.length !== 1 || sections.length > 1
    || (sections.length === 1 && sections[0].index >= licenses[0].index)) {
    throw new SyncError('Root README needs one License section and at most one Contributors section before it')
  }
  let index = licenses[0].index
  let addition = `## Contributors${newline}${newline}${block}`
  if (sections.length) {
    index = headings[headings.indexOf(sections[0]) + 1].index
    addition = block
  }
  const prefix = readme.slice(0, index)
  const separator = !prefix || prefix.endsWith(newline + newline) ? '' : newline
  return prefix + separator + addition + newline + newline + readme.slice(index)
}

async function fetchPage(url, token, fetchImpl, timeoutMs) {
  const controller = new AbortController()
  let timer
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new SyncError('GitHub contributors API request timed out'))
    }, timeoutMs)
  })
  const request = async () => {
    let response
    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'dsh-next-plugins-contributor-sync',
        },
        redirect: 'error',
        signal: controller.signal,
      })
    } catch {
      throw new SyncError('GitHub contributors API request failed')
    }
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
      throw new SyncError('GitHub contributors API returned an invalid response')
    }
    if (response.status === 204) return { users: [], length: 0 }
    if (response.status !== 200) {
      throw new SyncError(`GitHub contributors API returned HTTP ${response.status}`)
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new SyncError('GitHub contributors API returned invalid JSON')
    }
    if (Array.isArray(payload) && payload.length > PER_PAGE) {
      throw new SyncError('GitHub contributors API exceeded the requested page size')
    }
    return { users: normalizeContributors(payload), length: payload.length }
  }
  try {
    // The deadline includes body parsing and bounds even an injected fetch that ignores abort.
    return await Promise.race([request(), deadline])
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch up to 1,000 records, never following untrusted Link URLs or publishing a partial list. */
export async function fetchContributors({
  repository, token, fetchImpl = globalThis.fetch, maxPages = MAX_PAGES, timeoutMs = 10_000,
} = {}) {
  validateMetadata(repository, token)
  if (typeof fetchImpl !== 'function' || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > MAX_PAGES
    || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new SyncError('Contributor fetch needs a function, 1-10 pages, and a 1-30000ms timeout', 2)
  }
  const contributors = []
  for (let page = 1; page <= maxPages; page++) {
    const { users, length } = await fetchPage(
      `https://api.github.com/repos/${repository}/contributors?per_page=${PER_PAGE}&page=${page}`,
      token, fetchImpl, timeoutMs,
    )
    contributors.push(...users)
    if (length < PER_PAGE) return normalizeContributors(contributors)
  }
  throw new SyncError('GitHub contributors API pagination limit reached; root README was not updated')
}

/** Inject fetch/files for offline tests; write only when the complete README actually changes. */
export async function synchronizeContributors({
  repository, token, fetchImpl, maxPages, timeoutMs,
  readmePath = new URL('../README.md', import.meta.url), read = readFile, write = writeFile,
} = {}) {
  validateMetadata(repository, token)
  let current
  try {
    current = await read(readmePath, 'utf8')
  } catch {
    throw new SyncError('Could not read root README')
  }
  const contributors = await fetchContributors({ repository, token, fetchImpl, maxPages, timeoutMs })
  const updated = updateReadme(current, contributors)
  const changed = updated !== current
  if (changed) {
    try {
      await write(readmePath, updated, 'utf8')
    } catch {
      throw new SyncError('Could not write root README')
    }
  }
  return { changed, count: contributors.length }
}

/** CLI diagnostics never include environment values, remote bodies, or raw exception messages. */
export async function runCli({ env = process.env, log = console.log, error: reportError = console.error, ...options } = {}) {
  try {
    const { changed, count } = await synchronizeContributors({
      ...options, repository: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN,
    })
    log(`update-contributors: root README ${changed ? 'updated' : 'unchanged'} (${count} human contributors; bots excluded)`)
    return 0
  } catch (error) {
    reportError(`update-contributors: ${error instanceof SyncError ? error.message : 'Synchronization failed'}`)
    return error instanceof SyncError ? error.exitCode : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runCli()
}
