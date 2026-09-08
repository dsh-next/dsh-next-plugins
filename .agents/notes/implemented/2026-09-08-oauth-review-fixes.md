# Fix the OAuth review findings

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-oauth-providers; isolated OAuth mount verification

Resolved all nine findings from the earlier review in a follow-up bug-fix pass,
separate from its discovery refactor. Credential writes honor queued
cancellation without losing rotated refresh tokens. Login admission and
termination now have one owner; teardown cancels resources and fences late
continuations. RPC input handling is validated and byte-safe. Browser rows keep
stable identities and family-local drafts, and locale registration owns its
receiver and disposers.

Added regression and contract coverage before implementation, including the
real pi-ai queued-write cancellation path and published locale SDK. The expanded
OAuth E2E marker lives in its own helper, drives real browser editing and
asserts persisted settings. The scratch profile explicitly denies unused
transitive build scripts, matching the existing repository policy rather than
enabling scripts or disabling the safety gate.

[The updated review report](../../../docs/archive/2026-09-08-oauth-review.md)
owns the finding-to-test map, complete validation evidence, screenshot location,
and the precise cancellation boundary for already-started SDK storage writes.
Both host and browser fixes received independent review. README behavior copy
was updated in English and Chinese and pairing hashes refreshed.

No CSS geometry, dependency versions, DSH checkout, real account credentials or
unrelated plugin source was changed. The plugin remains private, so no changeset
was added. No commits were made.
