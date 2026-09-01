# cc-plugins rewrites plugin-level skill references to resolvable paths

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-cc-plugins

## What

Follow-up to the reference-note fix (and the user's question "should we
actually fix it"): plugin-level references in installed skill copies are
now rewritten so the model reads a working path instead of a dead one.
User chose the rewrite approach (option A) over self-contained
vendoring or note-only.

New `core/references.ts` (pure):

- `rewriteSkillReferences(content, skillDir, files, pluginRoot)` rewrites
  relative-path tokens that provably resolve inside the plugin into
  `${pluginRoot}/<resolved>` absolute paths. `../`-chains resolve against
  the skill's plugin-relative directory (Claude's file-relative semantic);
  bare `dir/...` forms resolve against the plugin root (Claude's
  cwd-relative semantic). Rails: existence-checked against the plugin
  file map (file or directory prefix), must land outside the skill's own
  directory (in-skill relatives work verbatim), URLs/prose/unknown paths
  and anything escaping the plugin root stay byte-identical, trailing
  sentence dots peel into a suffix, and pure up-chains (`../`) are
  ignored.
- `rewriteSkillFiles(files, skills, pluginRoot)` applies it to every file
  of every skill (bundle, flat, and manifest-redirected file forms each
  map back to their true plugin-relative key) and returns a copied map
  with `{ rewrites, skills }` counts. The source map is never mutated.

## Service wiring

installPlugin and updatePlugin rewrite once
(`rewriteSkillFiles(resolved.files, inventory.skills, pluginRootOf(key))`)
and copy skills from the rewritten map; the materialized plugin copy and
`saveCachedPluginFiles` keep the ORIGINAL verbatim map (hooks and the
runtime bridge see pristine content). A note
`rewrote N plugin-level reference(s) in M skill(s) to the materialized
plugin copy` records the divergence; `pluginLevelReferenceNotes` now
analyzes the REWRITTEN map, so it only reports leftovers.

Two detector fixes found on the way:

- The note's bare-form boundary now excludes a preceding slash — a
  mention inside a larger path (in-skill relative, or a rewritten
  absolute like `.../plugins/<key>/references/x`) is not a standalone
  plugin-level reference.
- The rewrite token boundary must not exclude `(`: markdown links
  (`[](../../references/)`) are the primary real-world form.

## Why not the alternatives

- Self-contained vendoring duplicates content per skill per root and
  breaks on in-skill name collisions.
- Symlinked skill dirs do not help: models resolve `../..` lexically, so
  the path still points outside the root.
- Placing dirs where the lexical path points (`~/.agents/references/`)
  pollutes shared space with cross-plugin collisions.

Behavioral parity argument: Claude Code's links work; dead links were the
divergence. Rewriting restores the behavior at the cost of a documented,
noted, existence-checked textual divergence in installed copies only.

## Verification

- `tests/references.spec.ts` (16 tests): both resolution modes, depth
  sensitivity, dir links, punctuation, immunity rails, all three skill
  forms, source-map immutability.
- `plugin-inventory.spec.ts`: embedded-path silence regression.
- `service.spec.ts` (refs-repo fixture): rewrite note reported, dead-path
  note gone, installed copy carries the absolute path, materialized copy
  and referenced file verbatim/present.
- Package suite 364 green; README pair updated and re-paired.
