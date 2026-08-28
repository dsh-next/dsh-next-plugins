# Notify with an emoji type title and the session title as the body

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier

Browser notifications now say what happened and where at a glance, with the
type plus a per-kind emoji icon in the headline and the session title in the
body.

- Host (`src/host/notifier.ts`): each queued notification's `title` is a clean
  event-type headline instead of the generic "DeepSeek Harness" /
  "DeepSeek Harness · X": "Agent finished", "Approval needed", "Question asked",
  "Subagent finished", "Goal completed", "Goal blocked".
- Client (`src/client/drainer.ts`):
  - `notificationTitle` renders the headline as `<emoji> <type>`, choosing the
    emoji from the event kind (✅ finished, ⚠️ approval, ❓ question,
    👥 subagent, 🏆 goal-complete, 🚫 goal-blocked; 🔔 default for an unknown
    kind). The emoji are written as unicode escapes so the plugin source stays
    ASCII (repository no-emoji convention) while the browser shows the emoji.
  - `notificationBody` is the session's display title (resolved live from the
    session list); it falls back to the Host-supplied detail when the session is
    unknown.
  - Settings card ("Test browser notification") uses the same rule, reading
    "🔔 Test notification · <session>".

Added `tests/drainer.spec.ts` cases: the kind-emoji title, the session-title
body, the per-kind emoji set, the unlisted-session detail fallback, the
unknown-kind default emoji, and the empty-title fallback. The notifier is now
71 tests.

Verified `pnpm typecheck` clean, notifier 71 tests green, `pnpm build` succeeds
(emoji glyphs present in the client bundle), `bash scripts/e2e-mount.sh`
1 passed, `pnpm docs:check` 10 READMEs.
