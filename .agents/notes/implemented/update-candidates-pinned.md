# Update candidates are pinned to the recorded provider

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-skills

A skill offered by several providers cycled the Update button forever: the
listing counted EVERY same-name catalog entry differing from the local
fingerprint as a candidate, so updating to one provider left the others
"differing" and the next click switched vendors.

Fix — update candidates are now pinned to provenance:

- A skill with an installations record considers only its recorded provider's
  catalog entry (preferring the recorded skillPath). Same-name entries from
  other providers are never update candidates; switching vendors is a
  deliberate delete-and-reinstall.
- An unrecorded hand-created copy may still adopt any same-name catalog skill;
  the first update pins it via the ledger record.
- Externally-owned skills (cc-plugins sidecar) get no update candidates at
  all, and `updateSkill` rejects owned directories ("update it through that
  plugin") — the owning plugin drives their updates.
- The panel additionally hides Update for owned rows even if a stale host
  envelope still carries candidates.

Follow-up (not built): a deliberate "switch provider" affordance in the
detail modal if vendor switching should ever be first-class.
