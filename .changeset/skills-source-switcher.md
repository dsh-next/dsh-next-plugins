---
"@dsh-next/dsh-next-skills": minor
---

Collapse provider offerings into a per-copy source switcher. An installed
skill now renders a single card with a "Providers" button (counting how many
providers offer the name) instead of one card per provider offering. The
switcher lists Local plus every provider with its content parity
("matches your copy" / "differs from your copy"), marks the current source,
and requires an explicit overwrite confirm before switching: the copy's files
are rewritten in place, files outside the provider copy are removed
permanently (not moved to trash), and visibility scopes are kept. Choosing
Local detaches the copy from its provider (files stay, updates stop) and
applies directly. The Update button is now strictly provenance-pinned: it
fires only for a copy's recorded provider, so hand-managed copies pick a
source explicitly instead of an implicit first match.
