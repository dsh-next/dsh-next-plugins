# Releasing the subscription plugin

- date: 2026-09-10
- status: implemented
- scope: packages/dsh-next-oauth-providers

Removes `"private": true` from the manifest so
`@dsh-next/dsh-next-oauth-providers` publishes with the next release, per
`docs/publish-prep.md` ("When the package is ready, remove `"private": true`
from its manifest and the next change file releases it").

The version drops to `0.0.0` so the pending `minor` change file publishes
`0.1.0` as the first public version, matching every sibling package. This
follows the checkpoints precedent (`chore(checkpoints): start the first release
at 0.0.0`); the bump itself still comes from the change file, never a manual
edit.

The change file `.changeset/oauth-providers-go-live.md` is a `minor` entry
naming only this package. It has to exist because the now-publishable package
carries source changes in the same branch: before the flag came off, the
changeset gate saw a private package and demanded nothing.

Both README halves lose the "currently private" bullet, and the pairing record
is re-written.

Still unverified by this change: a live end-to-end provider sign-in (browser or
device-code) and a live model request. What was verified is the failure the
plugin shipped with, fixed in
[the runtime profile note](2026-09-10-oauth-runtime-profile-modelerrors.md),
plus the model catalog and picker rendering the ChatGPT group from a real
grant. Anyone running the sign-in flow before merge should treat it as the
remaining release gate.
