#!/usr/bin/env node
/**
 * Regenerate the contributor list into README.md from the GitHub API.
 * Requires GITHUB_REPOSITORY and GITHUB_TOKEN in the environment.
 */
const repo = process.env.GITHUB_REPOSITORY || ''
const token = process.env.GITHUB_TOKEN || ''

if (!repo || !token) {
  console.error('update-contributors: GITHUB_REPOSITORY and GITHUB_TOKEN are required')
  process.exit(2)
}

const [owner, name] = repo.split('/')
const res = await fetch(
  `https://api.github.com/repos/${owner}/${name}/contributors?per_page=100`,
  { headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github+json' } },
)
if (!res.ok) {
  console.error(`contributors API failed: ${res.status}`)
  process.exit(1)
}
const contributors = await res.json()
if (!Array.isArray(contributors)) {
  console.error('contributors API returned an unexpected payload')
  process.exit(1)
}

console.log(`contributors: ${contributors.length}`)
// This is a minimal stub; a real implementation would update a Contributors
// section in README.md. Kept small so a missing token never blocks local dev.
