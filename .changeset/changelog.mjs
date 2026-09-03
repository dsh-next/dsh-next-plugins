// Custom changesets changelog formatter.
//
// The changesets default (`@changesets/cli/changelog`) prefixes every entry
// with a truncated git commit hash (e.g. `- a1b2c3d: Fixed ...`) that means
// nothing to a changelog reader, and its dependency line repeats that hash.
// This formatter produces clean, human-first entries: the summary the author
// wrote, with no plumbing noise.
//
// It is resolved by `.changeset/config.json` via `"changelog":
// ["./.changeset/changelog.mjs", null]`. The file must stay plain ESM
// JavaScript exporting exactly these two functions: changesets calls
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

const changelogFunctions = {
  getReleaseLine: (changeset, _type, _changelogOpts) => {
    const [firstLine, ...futureLines] = changeset.summary
      .split('\n')
      .map((l) => l.trimEnd())
    let returnVal = `- ${firstLine}`
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
