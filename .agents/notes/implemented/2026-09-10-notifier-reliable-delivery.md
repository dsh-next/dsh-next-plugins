# Notifier reliable delivery

- date: 2026-09-10
- status: implemented
- scope: packages/dsh-next-notifier

Implemented the user-authorized notifier audit fixes. The [bilingual first-run guide](../../../packages/dsh-next-notifier/README.md) owns user-facing triggers, controls, delivery limits, and the 17-sound library; it replaces the former architecture/development handbook. The [patch changeset](../../../.changeset/notifier-reliable-delivery.md) is a draft release intent, not a version bump.

## Implementation decisions

- [Event wiring](../../../packages/dsh-next-notifier/src/host/events.ts) uses root-session terminal reasons and canonical `subagent/end` for opt-in child alerts. Per-session settling and cancellation prevent stale finishes; goal terminal changes deduplicate against ordinary finishes. Active, armed goal-only filtering does not hide errors.
- Human questions use the official `user-questions/request` seam after SDK delegated-agent, live-owner, and validation guards, rather than observing tool dispatch. Approval/question promise observation preserves results and rejections, delays pending alerts by 200 ms, and withdraws queued work on settlement or abort.
- [Presence](../../../packages/dsh-next-notifier/src/client/presence.ts) and the [delivery broker](../../../packages/dsh-next-notifier/src/host/delivery-broker.ts) use per-client UUIDs and monotonic sequences. Presence expires after 120 seconds to accommodate hidden-tab throttling. Fresh focused clients take priority over background clients with permission; each event has one 10-second lease. Focus evidence expires after 10 seconds, separately from page liveness, and equally eligible clients can claim atomically without a sticky global owner. Pending delivery is bounded to 120 seconds while a page is alive, not an offline inbox.
- [Client delivery](../../../packages/dsh-next-notifier/src/client/drainer.ts) and [toasts](../../../packages/dsh-next-notifier/src/client/toasts.tsx) acknowledge committed visible toasts or browser `onshow` before automatic sound. Native browser sound is requested silent. This is API-level acknowledgement, not proof that the OS displayed a desktop banner.
- [Settings](../../../packages/dsh-next-notifier/src/client/card.tsx) keep a stable 600 ms volume debounce and serialize minimal saves and previews, surfacing failures. The [sound driver](../../../packages/dsh-next-notifier/src/host/sound-driver.ts) isolates private temporary WAV directories, caches/coalesces synthesis, publishes atomically, and cleans up owned files.
- Lifecycle disposal owns listeners, timers, pending requests, delivery work, and UI cleanup. Keyboard dismissal no longer activates a toast. [RPC validation](../../../packages/dsh-next-notifier/src/host/rpc.ts) distinguishes malformed requests (400), read-only settings (403), and internal failures (500).

## Validation ownership

The full repository gate passed: `pnpm typecheck && pnpm test && pnpm build && pnpm runtime-deps:check && pnpm docs:check && pnpm i18n:check && git diff --check`. All 1,417 unit tests passed, including 322 notifier tests across 16 suites (the prior notifier suite contained 103 tests). The notifier-only typecheck/test/build gate also passed. The lockfile adds only the official question SDK; no unrelated dependency upgrades were introduced.

Independent review reproduced and then drove fixes for acknowledgement deduplication after lease expiry, expired claim responses, hung browser RPC, and a failing background renderer monopolizing ownership. Leases carry explicit expiry; failed renderers cool down; browser requests time out after eight seconds and abort on disposal. Rendering is retried after a new lease rather than assuming an old toast is still visible. Delivery remains best effort under network partitions; OS banner presentation cannot be guaranteed.

A real dark-theme settings capture is checked in at [media/settings.webp](../../../packages/dsh-next-notifier/media/settings.webp), encoded at its native 564 by 390 size. Browser acceptance, deferred onshow, error/no-show paths, and entrypoint replacement cleanup have regression coverage in [browser-lifecycle.spec.tsx](../../../packages/dsh-next-notifier/tests/browser-lifecycle.spec.tsx). Windows sound playback remains contract-only tested, not live Windows evidence. The final combined real-mount run passed both Playwright tests against DSH 0.1.3-alpha.2: the complete packed-plugin family mount and a separate real agent turn using deliberately invalid credentials. The latter rendered an Agent error toast, not Agent finished. The mount marker also verified malformed RPC rejection, saved volume, distinct browser client IDs, and keyboard dismissal. Command: `DEEPSEEK_API_KEY=fake-e2e-key KEEP_HOME=1 bash scripts/e2e-mount.sh`. All temporary servers were owned by the smoke script and stopped on exit; the existing GUI at port 3080 was not modified or restarted. Runtime follow-up also exposed turn-number reuse after synthetic checkpoint/reset markers and an abandoned browser context retaining delivery priority. New regressions reset terminal deduplication on committed turn/start and permit any equally eligible fresh client to claim, with separate 10-second focus freshness.

Tests to use when recording final evidence:

| Area | Test locations |
| --- | --- |
| Event reasons, goal/subagent deduplication, human request lifetime | [events.spec.ts](../../../packages/dsh-next-notifier/tests/events.spec.ts), [config-decision.spec.ts](../../../packages/dsh-next-notifier/tests/config-decision.spec.ts) |
| Client ownership, expiry, leases, acknowledgement and retries | [delivery-broker.spec.ts](../../../packages/dsh-next-notifier/tests/delivery-broker.spec.ts), [presence.spec.ts](../../../packages/dsh-next-notifier/tests/presence.spec.ts), [drainer.spec.ts](../../../packages/dsh-next-notifier/tests/drainer.spec.ts) |
| Settings races, errors and keyboard dismissal | [card-settings.spec.tsx](../../../packages/dsh-next-notifier/tests/card-settings.spec.tsx), [card.spec.tsx](../../../packages/dsh-next-notifier/tests/card.spec.tsx), [toasts.spec.tsx](../../../packages/dsh-next-notifier/tests/toasts.spec.tsx) |
| RPC shape, validation and roundtrip | [rpc-contract.spec.ts](../../../packages/dsh-next-notifier/tests/rpc-contract.spec.ts), [rpc-validation.spec.ts](../../../packages/dsh-next-notifier/tests/rpc-validation.spec.ts), [rpc-roundtrip.spec.ts](../../../packages/dsh-next-notifier/tests/rpc-roundtrip.spec.ts) |
| Sound files, playback contracts and synthesis | [sound-driver.spec.ts](../../../packages/dsh-next-notifier/tests/sound-driver.spec.ts), [synth.spec.ts](../../../packages/dsh-next-notifier/tests/synth.spec.ts) |
| Real DSH mount | [mount.e2e.ts](../../../tests/e2e/mount.e2e.ts) |

The [completeness contract](../../../docs/plugins.md#the-completeness-contract), [local testing instructions](../../skills/dsh-next-local-testing/SKILL.md), and [contributor guide](../../../CONTRIBUTING.md) own validation procedure. The [README contract](../../../docs/AGENTS.md#package-readmes) and [pairing rules](../../../docs/i18n.md) own documentation checks and real screenshot requirements.

## Local web-profile installation

Rebuilt and packed the notifier, then installed the local tarball through `dsh plugin --profile web add file:<tarball>`. The profile manifest and lockfile were backed up first; all other profile dependencies and bundle entries were preserved. Installed host and browser bundles matched the compiled files byte-for-byte. `dsh --profile web --dump-config` exited successfully and included the notifier; it also reported an unrelated existing global patch reference to the unmounted `dsh-next-cc-plugins` row. The running GUI process was left untouched: restart DSH, then refresh the browser to activate the new host/client pair.
