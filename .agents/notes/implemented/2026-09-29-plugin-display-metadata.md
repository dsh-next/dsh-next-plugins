# Plugin display metadata

- date: 2026-09-29
- status: implemented
- scope: plugin display metadata across the seven main plugins and squads in `.worktrees/create-squads-plugin`

The requested rollout adds localized installed-plugin titles/descriptions and
package-root icons without changing npm or Cordis identities. The canonical
authoring contract is now documented in
[Plugin display metadata](../../../docs/plugins.md#plugin-display-metadata),
including the separation from client dictionaries and React icons, package
exports, packed assets, and icon path/format/size constraints.

Static icon artwork is the narrow color-token exception: an SVG rendered as a
standalone `img` cannot inherit host CSS tokens, so its explicit colors use a
sampled native artwork palette. This does not relax browser UI token rules.

The new-plugin scaffold emits these resources and humanizes the slug without changing package identity, including slugs with repeated hyphens. The pack guard now permits language-named locale JSON and image assets, and checks that the declared icon is present. Matching guard changes in the Squads worktree preserve its existing example-file exception.

Validation:

- Main workspace `pnpm run check` passed (types, package and script tests, build, runtime dependencies, docs, i18n). The bundled signed Node could not load local native modules; verification used the repository-pinned mise Node 22.22.0 instead.
- Final script regression suite passed after the packaging and repeated-hyphen fixes.
- Squads: 539 unit tests, typecheck, build, docs/i18n checks, packaging tests, and all four real-browser Squads tests passed. Its actual plugin card was inspected in dark and light themes.
- Main packed-family smoke passed all eight browser tests, including every installed package's readable title, concise description, and decoded SVG. Dark/light screenshots were inspected under `artifacts/plugin-metadata-main/run-W3wkQc/`; Squads evidence is under `artifacts/plugin-metadata-squads/run-Tp0AoJ/`.
- The new metadata test handles late onboarding dialogs before navigation. Initial development runs exposed test-only CJS URL and accessible-name mismatches; both were corrected without weakening metadata assertions.
- The full all-suites keyless `ci` lane was not run; the static gate, family smoke, and named Squads suite are the verification performed for this metadata-only change.

No installed user profile was changed, and no Harness source was modified. Existing unrelated work in both checkouts was preserved. Release intent names only the four publishable main packages; private packages remain private.
