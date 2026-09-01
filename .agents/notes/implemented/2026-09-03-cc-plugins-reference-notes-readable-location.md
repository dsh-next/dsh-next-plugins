# cc-plugins reference notes name the readable location

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-cc-plugins

## What

User report after updating holistics-reporting to 0.1.2: the install note
`1 skill(s) reference plugin-level "references/"; those paths do not
resolve from the installed skills root` read as a dead end. The note is
correct (holistics skills point at `../../references/holistics.md`, which
resolves in Claude Code's intact plugin tree but not from DSH's standalone
skill installs), but it never said where the referenced files DO live.

Fix, in `pluginLevelReferenceNotes` (`core/plugin-inventory.ts`):

- Optional `readFrom` argument (the materialized plugin copy's absolute
  path, passed by both service call sites as `pluginRootOf(key)`); the
  note now ends with `; read them from <root>/<dir> instead`. For the
  reporting user that is
  `~/.dsh/cc-plugins/plugins/github_holistics_skills_holistics-reporting/references`.
- The reference regex's trailing path part became optional so bare
  directory links (`[](../../references/)` — the form search-docs uses)
  count as references; holistics-reporting now notes 2 skill(s), not 1.

Existing records keep their old note text until the next
install/update regenerates it.

## Verification

- `plugin-inventory.spec.ts`: readFrom-appended expectation, a
  bare-directory-link case, and the unchanged prose/component-root
  silences.
- `service.spec.ts` (refs-repo fixture): the install message and the
  persisted record note both carry
  `read them from /home/u/.dsh/cc-plugins/plugins/github_o_refs-repo_refsy/references instead`.
- Package suite 347 green; README pair updated and re-paired.
