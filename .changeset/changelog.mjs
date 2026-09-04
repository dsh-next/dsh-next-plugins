// Custom changesets changelog formatter.
//
// The changesets default (`@changesets/cli/changelog`) prefixes every entry
// with a truncated git commit hash (e.g. `- a1b2c3d: Fixed ...`) that means
// nothing to a changelog reader, and its dependency line repeats that hash.
// This formatter produces clean, human-first entries: the summary the author
// wrote, followed by a linked attribution for the author of the pull request
// that introduced the change file:
//
//   - Fixed notification title truncation at 40 characters. ([@octocat](https://github.com/octocat))
//
// Attribution mechanics: when `changeset version` runs, changesets stamps each
// pending change file with `commit`, the SHA of the commit that ADDED the
// file. The formatter asks the GitHub API for the pull request associated
// with that commit (`GET /repos/{repo}/commits/{sha}/pulls`) and appends the
// PR author's login, linked to their GitHub profile. Attribution resolves in
// the release pipeline, where `.github/workflows/release.yml` provides
// `GITHUB_TOKEN` to the `changeset version` step.
//
// Attribution is best-effort and never fails versioning: an entry lands
// WITHOUT it when there is no associated pull request (a change file pushed
// directly to `main`, or one authored on the Version Packages PR itself), no
// `repo` option in `.changeset/config.json`, no `commit` on the changeset, no
// `GITHUB_TOKEN` in the environment (local runs), or any API error (rate
// limit, network). It is never hand-written into change files; the formatter
// owns it.
//
// The formatter is resolved by `.changeset/config.json` via `"changelog":
// ["./changelog.mjs", { "repo": "dsh-next/dsh-next-plugins" }]`. The file must
// stay plain ESM JavaScript exporting exactly the two changesets functions
// (`getReleaseLine`, `getDependencyReleaseLine`) plus the named test seams;
// changesets calls
// `getReleaseLine(changeset, type, changelogOpts)` and
// `getDependencyReleaseLine(changesets, dependenciesUpdated, changelogOpts)`
// and pastes the returned strings into the generated `CHANGELOG.md`.
//
// Only the per-entry bullets pass through this formatter — the `## x.y.z`
// version headers are emitted by changesets and carry no link (the package
// family versions independently and does not use git tags, so there is no
// tag-based compare URL to attach). Do not re-add hashes here; a changelog is
// for users, and "keep a changelog" convention is strictly human-readable
// entries.

const GITHUB_API = 'https://api.github.com'

// Returns the login of the author of the first pull request associated with
// `commit`, or null when the commit has no associated PR (direct push).
// Throws on transport or API errors; callers treat every failure as "no
// attribution". `fetchImpl` is injectable so tests cover all branches without
// network.
async function findPrAuthor({ repo, commit, token, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `${GITHUB_API}/repos/${repo}/commits/${commit}/pulls`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    },
  )
  if (!response.ok) throw new Error(`GitHub API responded ${response.status}`)
  const pulls = await response.json()
  if (!Array.isArray(pulls) || pulls.length === 0) return null
  const login = pulls[0]?.user?.login
  return typeof login === 'string' && login.length > 0 ? login : null
}

// Resolves the attribution suffix for one changeset, or null when attribution
// is impossible or the lookup fails. Guards (no repo option, no commit, no
// GITHUB_TOKEN) short-circuit before any network call so local `changeset
// version` runs stay offline-safe and fast.
async function resolveAttribution(changeset, changelogOpts, fetchImpl = fetch) {
  const repo = changelogOpts?.repo
  const commit = changeset?.commit
  const token = process.env.GITHUB_TOKEN
  if (!repo || !commit || !token) return null
  try {
    const login = await findPrAuthor({ repo, commit, token, fetchImpl })
    if (!login) return null
    return `([@${login}](https://github.com/${login}))`
  } catch {
    return null
  }
}

const changelogFunctions = {
  getReleaseLine: async (changeset, _type, changelogOpts) => {
    const [firstLine, ...futureLines] = changeset.summary
      .split('\n')
      .map((l) => l.trimEnd())
    let returnVal = `- ${firstLine}`
    // Attribution sits at the end of the first line so it stays visible even
    // when the summary wraps onto continuation lines.
    const attribution = await resolveAttribution(changeset, changelogOpts)
    if (attribution) returnVal += ` ${attribution}`
    if (futureLines.length > 0) {
      returnVal += `\n${futureLines.map((l) => `  ${l}`).join('\n')}`
    }
    return returnVal
  },
  getDependencyReleaseLine: (changesets, dependenciesUpdated, _changelogOpts) => {
    if (dependenciesUpdated.length === 0) return ''
    const changesetLinks = changesets.map(() => '- Updated dependencies')
    const updatedDependenciesList = dependenciesUpdated.map(
      (dependency) => `  - ${dependency.name}@${dependency.newVersion}`,
    )
    return [...changesetLinks, ...updatedDependenciesList].join('\n')
  },
}

export default changelogFunctions

// Test seams (ignored by changesets): exported so the script test lane
// (scripts/changelog-formatter.test.mjs) can exercise lookup branches with an
// injected fetch.
export { findPrAuthor, resolveAttribution }
