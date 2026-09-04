# 2026-09-04 — Skills search: relevance ranking + pagination reset

## Symptom

Typing "create" (or any word) into the Skills search box surfaced cards that
look unrelated (`docx`, `pptx`, `obsidian`, `apple-notes`) while real name
matches sat buried. Investigation in the real mount (Playwright against the
demo server) showed the filter itself worked — every rendered card matched
somewhere — but the match surface is name + description + provider spec, all
substring hits ranked equally, and the grid kept its alphabetical order and
its 30-card page. Description-only hits dominated the visible page; a name
match deeper in the alphabet (or behind Show more) never surfaced.

## Why the gates missed it

- The pure `filterEntries` unit tests asserted match/no-match only, never
  relevance order — alphabetically-shuffled description hits passed.
- The e2e marker never typed into the search box: zero wiring coverage in the
  real mount.

## Fix (`packages/dsh-next-skills`)

- New exported `searchTier(entry, q)`: 0 exact name, 1 name prefix,
  2 name contains, 3 description/provider contains, undefined = no match.
- `filterEntries` now stable-sorts the hits by tier; within a tier the grid
  order (installed first, then name/provider) is preserved. Empty query = no
  shuffle.
- The panel resets `visible` to `PAGE_SIZE` whenever search/provider
  filter/installed-only changes, so a fresh search starts at page one.
- Tests: tier units + ranked order + empty-query stability (pure); a jsdom
  wiring test that types into the real input and asserts the name match
  renders above an alphabetically-earlier description-only match; a
  pagination-reset test (page deep, search, assert 30 + pager returns).
- e2e: the seed gains a second catalog offering `aaa-offering` whose
  description deliberately mentions `e2e-test` while sorting first
  alphabetically; the marker types `e2e-test` and asserts the seeded skill's
  card renders first, plus a no-hit query hitting the empty state.

## Validation

- 264 skills tests green; full monorepo gate green; `e2e-mount.sh` pass with
  the new search step.
- Verified in the real demo browser before/after: 34 matches for "create"
  with description hits filling page 1 → name matches first after the fix.
