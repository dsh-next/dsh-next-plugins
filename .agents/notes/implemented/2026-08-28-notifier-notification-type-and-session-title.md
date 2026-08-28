# Make notifier notifications name the event type and session title

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier

Browser notifications now say what happened and where, so a glance tells the
type and the session without opening the page.

- Host (`src/host/notifier.ts`): each queued notification's `title` is now a
  clean event-type headline instead of the generic "DeepSeek Harness" /
  "DeepSeek Harness · X": "Agent finished", "Approval needed", "Question asked",
  "Subagent finished", "Goal completed", "Goal blocked".
- Client (`src/client/drainer.ts`): `showWebNotification` appends the session's
  display title to the headline (resolved from the live session list), so it
  reads e.g. "Approval needed · Design spec". A session that is absent/unlisted
  falls back to the bare type; an empty title falls back to "DeepSeek Harness".
- Settings card ("Test browser notification") now uses "Test notification" as
  its headline so it reads "Test notification · <session>" under the same rule.

Added `tests/drainer.spec.ts` cases for the headline composition: appending the
session title, keeping the headline for an unlisted session, for no session, and
the empty-title fallback. The notifier is now 70 tests.

Verified `pnpm typecheck` clean, notifier 70 tests green, `pnpm build` succeeds
(type labels in the host bundle, session-title logic in the client bundle),
`bash scripts/e2e-mount.sh` 1 passed, `pnpm docs:check` 10 READMEs.
