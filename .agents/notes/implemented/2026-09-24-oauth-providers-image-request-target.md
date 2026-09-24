# Image turns fail on the OAuth routes: adapter older than the attachment service

- date: 2026-09-24
- status: implemented
- scope: packages/dsh-next-oauth-providers

## Symptom

Every image turn on a subscription route failed with

```
This turn failed  Image request width must be a positive integer.
```

Text turns on the same route worked, the model was GPT-6 Luna, and a later
text-only turn failed too because the earlier image stayed in the session.
Reported after the pi-ai 0.87.1 bump made the new codex models selectable.

## Root cause

The plugin's runtime SDK copy was older than the service it talks to. The `web`
profile mounts the plugin as a `link:` to this checkout, so Node resolves the
plugin's bare `@deepseek-ai/*` imports from the repo's own `node_modules` — the
*devDependencies* — instead of the profile tree. Those sat on
`0.1.5-rc.1`/`0.1.6-alpha.2` while the harness provides `0.1.7-rc.1`.

The image contract changed across that gap:

- `@deepseek-ai/dsh-llm-pi-ai@0.1.5-rc.1` calls
  `attachments.readImageRequest(ref, policy, signal)` with the route pixel
  policy `{ maxPixels, maxBytes }`.
- `@deepseek-ai/dsh-attachment-local@0.1.7-rc.1` expects a *computed* target
  `{ width, height, maxBytes }` and validates it first thing
  (`requestImageWidth` → `validateTarget`). Reading `target.width` off a policy
  object yields `undefined`, so `requestImageDimensions` produces `NaN` and the
  service throws `Image request width must be a positive integer`
  (`INVALID_ATTACHMENT_REF`).

A minimal repro against the real 0.1.7 local store settles it — the call shape
alone decides the outcome:

```
readRequestImageFile(..., { maxPixels, maxBytes })   -> INVALID_ATTACHMENT_REF | Image request width must be a positive integer.
readRequestImageFile(..., { width, height, maxBytes }) -> INVALID_IMAGE | Unsupported or malformed image data.
```

The second call is rejected for the deliberately bogus bytes, i.e. it passed
target validation. So the model is incidental: any image on any of the four
OAuth routes fails, and only the linked dev mount is affected — a published
install has no devDependencies, resolves the adapter from the profile tree and
takes the 0.1.7 path.

## Fix

- Every `@deepseek-ai/*` devDependency in this package pinned to the runtime
  version `0.1.7-rc.1` (`@deepseek-ai/dsh-client-runtime` stays on
  `^0.1.1-rc.2`, its own train's latest).
- Two type adaptations the SDK jump required: `rewriteMessagesForNative` now
  takes `GenerateOptions.messages`'s `RequestMessage` (0.1.7 allows
  identity-free user inputs) and stays generic over the input so narrower
  callers keep their own message type; two test fixtures cast the message id
  through `NonNullable<...>` because the wire union's `id` is optional.
- A regression test in
  [adapter-runtime.spec.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/tests/adapter-runtime.spec.ts)
  drives the real `PiAiAdapter` over a real profile with an image message and a
  store double, and asserts the store receives `{width, height, maxBytes}` with
  positive integers — the contract the old adapter broke.

## Verification

- The new test is red before the fix and green after, and the red failure is the
  right one: with the whole SDK set back on `0.1.5-rc.1` it fails
  `expected { width: false } to deeply equal { width: true }` — the policy shape
  reaching the target validator. It fails at the target assertion, not at
  reaching the store.
- Typecheck clean; the package runs 245 tests in 29 files (was 241; the new
  test adds one per family).
- Resolution probe from the package root: `dsh-llm-pi-ai`, `dsh-llm` and
  `dsh-attachment` all resolve at `0.1.7-rc.1`.
- Repo gate (`typecheck`, `test`, `build`, `docs:check`, `i18n:check`,
  `runtime-deps:check`) exits 0.

## Follow-up

- The running harness imports the host half at boot, so the `web` profile needs
  a restart before images work there; the browser half re-reads on page load.
- This is a per-package alignment. The workspace-wide SDK move is still blocked
  by `dsh-next-cc-plugins`, which uses APIs 0.1.7 removed — see
  [the dependency note](./2026-09-24-workspace-dependency-refresh.md).
