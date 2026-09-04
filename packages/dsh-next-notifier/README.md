# dsh-next-notifier

English | [中文](README.zh.md)

A DeepSeek Harness plugin that alerts you when the agent finishes its turn,
needs your approval, or asks you a question: an **in-page toast** while you are
looking at the page and a **browser (web) notification** when the window is
backgrounded or minimized, plus a configuration card in **Settings → Plugins**
with a curated sound library.

## Triggers

| Trigger | Notification |
| --- | --- |
| Agent finishes its turn | "Agent finished its turn." |
| Agent asks for an approval | "Approval needed — Waiting for your approval: `<tool>`" |
| Agent calls `ask_user_question` | "Question — The agent asked you a question…" |
| Subagent finishes (opt-in) | "A subagent finished its turn." |
| Session goal completes | "Goal completed — The session goal completed." |
| Session goal gets blocked | "Goal blocked — The session goal was blocked: `<reason>`" |

## Configuration UI

The card in Settings → Plugins offers:

- **Enable notifications** — master switch for everything.
- **Mute while viewing the session** — default on: stays quiet when the focused
  window shows the exact session that triggered the notification.
- **Volume** — 0–100 slider for all notification sounds. Loudness is baked into
  the synthesized WAVs (perceptual `(v/100)^2` gain), so every player honors it.
- **Per-category groups** (Agent finished / Approval needed / Question asked),
  each with: Notify, Play sound, and a Sound dropdown (previews on select). The
  finished group additionally has **Subagent finished** (opt-in) and **Only
  notify when the goal completes** (default on).
- **Test browser notification** — verifies the web layer and requests permission
  the first time.
- **Test in-page toast** — shows a sample toast inside the page.
- **Show details** — the backend sound-player line and a live focus-tracking line.

Changes apply immediately and persist in the settings document under the
`dsh-next-notifier` namespace.

## Sound library (17 synthesized sounds)

No audio assets ship: every sound is synthesized at startup as a WAV (16-bit
PCM, 22.05 kHz mono) and written into the OS temp dir.

| Group | Sounds |
| --- | --- |
| Chimes | Chime, Ping, Bell |
| Alerts | Alert, Error, Success |
| Effects | Chirp, Pop, Knock, Whoosh, Magic, Blip, Ring, Gong |
| Farts | Fart · Classic, Fart · Deep, Fart · Squeaky |

Defaults: finished = Chime, approval = Ping, question = Chirp.

Playback: `afplay` (macOS) / `Media.SoundPlayer` via PowerShell (Windows) /
`paplay` or `aplay` (Linux), played alongside the web notification.

## Delivery

Alerts arrive through the channel that fits where you are:

- **Looking at the page** (window focused and visible): an **in-page toast**
  slides in at the top of the window. Clicking the toast opens its session,
  the close button dismisses it, and toasts auto-dismiss after 12 seconds.
  Toasts need no browser permission.
- **Backgrounded or minimized**: a **browser (web) notification** with the
  DeepSeek icon — the OS shows it while the window is out of sight.
- **Page closed**: the alert is dropped.

Each alert's headline is an **emoji icon + the event type** (e.g.
"⚠️ Approval needed", "✅ Agent finished"), and the **body is the session's
title** (e.g. "Design spec"), so a glance tells you both what happened and in
which session. Clicking either channel opens that session.

## Architecture

- **Host** (`src/index.ts` + `src/host/`) — registers the settings namespace
  (Schemastery schema), listens to `agent/status`, `subagent/end`,
  `approval/request`, `tools/execute`, and `goal/changed`, and serves the RPC
  route at `POST /dsh-next-notifier/rpc`.
- **Client** (`src/client/`) — the settings card in `settings.plugin.item`,
  presence reporting, the web-notification drainer, and the in-page toast
  layer registered in the shell's `shell.overlay` slot.
- **Core** (`src/core/`) — pure shared logic: config normalization, WAV
  synthesis, and notification decision, unit-tested without a runtime.

## Install

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-notifier
```

## Development

```sh
pnpm build
pnpm typecheck
pnpm test
```
