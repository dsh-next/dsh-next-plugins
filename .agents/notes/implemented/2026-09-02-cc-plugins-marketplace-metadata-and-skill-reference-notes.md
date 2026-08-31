# cc-plugins: nested marketplace descriptions and plugin-level skill reference notes

- date: 2026-09-02
- status: implemented
- scope: packages/dsh-next-cc-plugins

Two fidelity fixes from live-testing the bridge against the real
`holistics/skills` GitHub marketplace (add by `owner/repo` shorthand,
browse its five plugins, install `analytics-finance` through the GUI —
skills landed in the isolated agents root, real `~/.agents` untouched):

- `parseMarketplaceIndex` now falls back to `metadata.description` when
  the top level has none (the nested form `holistics/skills` uses), with
  the top level still winning when both are present. A marketplace synced
  by an older build picks the description up after Refresh.
- New `pluginLevelReferenceNotes` (core) detects skills whose SKILL.md
  references directories that exist at the plugin level but outside every
  skill directory (the `references/` convention, `assets/`, ...). Claude
  Code resolves those from the plugin root; the DSH skills root installs
  each skill standalone, so the links would silently dangle. Install and
  update now aggregate a per-directory note ("2 skill(s) reference
  plugin-level \"references/\"; ..."). Detection requires the directory to
  exist in the plugin file map, so prose mentions never note, and the
  component roots (`skills/`, `commands/`, ...) are excluded.

README gains a "Marketplace fidelity notes" section covering both, plus
the two caveats that remain informational: skills may assume an MCP
server the plugin does not ship (nothing auto-configures), and plugins
absent from the index are correctly never offered.

Also confirmed during the same session: the GitHub sync path in a real
host (network tarball fetch, snapshot, index parse) — previously covered
only by the unit-level codeload double.

## Verification

174 tests across 12 suites (was 168): index fallback tests, reference
detection tests (hit, prose-only miss, component-root exclusion), and a
service-level assertion that the note reaches the install message and
the nested description reaches the marketplace row. Repo-wide typecheck,
test, build, docs:check, mount smoke, and a live refresh of the real
marketplace showing its description in the panel.
