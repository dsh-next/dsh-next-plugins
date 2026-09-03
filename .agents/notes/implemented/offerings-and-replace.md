# Offerings + Replace: every provider offering visible, one installed truth

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-skills

Supersedes the hiding side effect of `update-candidates-pinned.md`: the grid
used to drop same-name catalog entries once a name was installed
(`!installedNames.has(s.name)`), so after pinning, alternative providers of an
installed skill became invisible everywhere.

Design (rejected alternative first): duplicating the INSTALLED card per
provider would fabricate phantom copies — card identity is the physical copy
(`row:${source}:${path}`), Delete on any card would hit the same directory,
and enablement config is name-keyed (`scopes[name]`), so N rows would share
one toggle while looking independent. Implemented instead:

- `buildGridEntries` renders EVERY provider offering as its own card; a
  same-name offering of an installed non-owned copy carries
  `installed: { directory, active }` — the recorded source renders a
  `current source` chip, every other offering a **Replace** button that calls
  `updateSkill` (host already supported: rewrites files, re-pins the ledger
  provenance). One global alphabetical sort keeps same-name cards adjacent.
- Installed cards carry an `N sources` chip when more than one provider
  offers the name.
- Installed rows resolve `providerId` from their recorded provider spec via
  the provider rows (the provider filter now matches installed copies too;
  previously the id leaked from an arbitrary same-name catalog merge).
- Externally-owned copies (cc sidecar) hide their name's offerings and the
  sources chip entirely — unactionable affordances are not rendered.

Replace targets the first (highest-precedence) non-owned copy of the name;
with multiple global copies of one name the remaining copies are untouched
(same per-copy semantics as Update).

Follow-up (same change): installed groups sort before add-only groups, same-name cards share one bordered group box (`skills-group`, full-row, cards stacked), and the provider filter narrows a group to the matching cards only — a fully filtered group renders as a plain card with no wrapper.
