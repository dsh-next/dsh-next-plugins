# Narrowed the no-emoji rule to authored code, commits, and changelogs

- date: 2026-09-03
- status: implemented
- scope: repo (style rule + CI)

The blanket "no emoji" rule was over-reaching and its CI enforcement was
scanning the wrong set of files, so it failed on content it was never meant to
govern. Resolved by narrowing both the rule and its enforcement:

- **Old rule** banned emoji in "code, comments, documentation, UI text,
  scripts, and commit messages"; the CI check walked the filesystem with only
  `.git`/`node_modules`/`lib`/`dist` skipped, so it also flagged the gitignored
  `.pnpm-store/` cache (~18k emoji) and untracked vendored third-party skills.

- **New rule** (AGENTS.md "Repository Rules") bans emoji only in: source code
  and code comments (`.ts/.tsx/.js/.mjs/.mts/.cts/.jsx/.cjs` + shell scripts),
  embedded UI text in code, commit messages, and CHANGELOG / change-file
  entries. Exempt: documentation prose, Agent Notes (`.agents/notes/`),
  READMEs, and quoted product-output strings (emoji a plugin itself emits,
  e.g. the notifier's "⚠️ Approval needed").

- **CI check** now reads `git ls-files` (tracked files only — drops the
  `.pnpm-store` noise and untracked vendored skills) and filters to source
  extensions only, so `.md` docs/READMEs/notes are out of scope. Verified: 167
  tracked source files, 0 emoji.

No CHANGELOG files exist yet (first release pending), and no tracked change
file contains emoji, so there was nothing to strip from release notes; the
release skill and `.changeset/README.md` already mandate emoji-free entries,
which the narrowed rule now aligns with.

Pre-existing emoji in the notifier README pair and three Agent Notes are now
exempt (product-output strings and informal internal logs respectively), not
deletions.
