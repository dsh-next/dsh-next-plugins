#!/usr/bin/env node
/**
 * Generate fallback release notes for a tag. If a committed notes file exists
 * the release pipeline prefers it; this script is the fallback.
 * Usage: node scripts/release-notes.mjs <vX.Y.Z>
 */
const tag = process.argv[2] || 'v0.0.0'
const version = tag.replace(/^v/, '')

const lines = [
  `## ${tag}`,
  '',
  `Release of the dsh-next plugin family at unified version ${version}.`,
  '',
  '### Packages',
  '',
]

// No package list is embedded; the verify-version gate already enumerates them.
lines.push('All `@dsh-next/dsh-next-*` packages published at this version.')
lines.push('')

process.stdout.write(lines.join('\n'))
