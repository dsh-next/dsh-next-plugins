# Checkpoints file preview (GitHub layout, harness tokens)

The file modal is a unified diff: dual line numbers, `@@` hunk headers,
`+/-` gutters, and highlight.js syntax (languages from the path). Add/delete
fills and syntax colors use `--dsw-alias-*` tokens (`color-mix` tints), not
GitHub hex. `@git-diff-view/*` was dropped because its stylesheet is
Tailwind + hardcoded GitHub colors.

Hunks now carry `oldStart` / `newStart` / `lines` so the preview does not
need whole files on the wire.
