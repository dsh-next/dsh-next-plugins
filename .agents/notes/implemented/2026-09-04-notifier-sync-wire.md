# Notifier: wire event listeners synchronously during apply

- date: 2026-09-04
- status: implemented
- scope: packages/dsh-next-notifier

## Change

`Notifier.start()` awaited asynchronous sound detection (subprocess probes,
sound-set synthesis) and only then called `wire()`, which registers every
event listener through `ctx.on`. Effects may only be created while the
plugin's context is active; once loading has moved on, `ctx.on` throws
"cannot create effect on inactive context". The race usually resolved before
the listeners, so the bug stayed latent until a boot lost it — the real-mount
smoke then aborted with `fatal load failure: Error: cannot create effect on
inactive context` at `Notifier.wire`.

The fix moves all listener registration to the synchronous path: `apply`
calls `notifier.wire()` directly (before `void notifier.start()`), `wire` is
public, and `start` only does the asynchronous sound detection. Listening
never depended on the detection results, so behavior is unchanged.

## Files

- `src/host/notifier.ts`: `start()` no longer wires; `wire()` is public with
  the lifecycle rationale in its doc comment.
- `src/index.ts`: `apply` calls `notifier.wire()` synchronously before
  `void notifier.start()`.

## Validation

- Package: 71 tests pass (7 files), `tsc --noEmit` clean, tsdown build ok.
- `bash scripts/e2e-mount.sh` boots the full plugin set and the Playwright
  lane passes after the fix (previously fatal at boot).
