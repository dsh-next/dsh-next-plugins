# Rebuild dsh-next-notifier in TypeScript

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier

Replaced the JS prototype (host.js / client.js / package/* dynamic form) with a
single TypeScript package following the three-zone convention
(docs/package-structure.md): `src/index.ts` (thin host apply), `src/host/`
(stateful runtime), `src/core/` (pure logic), `src/client/` (settings card).

Decisions confirmed with the user:

- Full feature parity with the prototype (triggers, focus-aware mute,
  goal-aware mode, presence tracking, settings card).
- Schemastery settings schema (`settings.register`) replacing the hand-rolled
  normalizer; the legacy `agent-notifier` namespace migration was dropped.
- Web-only delivery with a same-origin `webServer` RPC route; icon extraction
  and serving dropped (web notifications render with no custom icon).
- Sound library trimmed from 24 to 17 (Chimes x3, Alerts x3, Effects x8,
  Farts x3).

SDK-contract improvements over the prototype (verified against the installed
@deepseek-ai/* 0.1.1-rc.2 types):

- Subagent-finished now uses the first-class `subagent/end` event
  (`info.id` = child session id) instead of `agent/status idle` +
  `agents.roots()` classification.
- Goal terminal states use `goal/changed` `operation === 'complete' | 'block'`
  instead of inspecting `goal.phase`.
- The `settings.plugin.item` slot is keyed by the settings namespace; the
  prototype's list-kind `id`/`order`/`label` fields do not apply to a keyed
  slot and were removed.
- Host peer SDK packages are externalized in the build (tsdown.config.ts
  `libExternal`) so they resolve from the DSH profile tree instead of being
  bundled (avoids duplicate schemastery/settings module identity).

Follow-up candidates (not done): add an inline data-URI whale icon if a custom
notification icon is wanted; add a runtime mount smoke assertion for the
notifier to tests/e2e/mount.e2e.ts.
