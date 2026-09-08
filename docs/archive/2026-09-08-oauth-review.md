# OAuth providers review and simplification

- Date: 2026-09-08
- Scope: `packages/dsh-next-oauth-providers` (untracked package at review start)
- Original verdict: **Request changes** before merge/release.
- Follow-up: all nine required findings fixed at the user's request.
- Method: tests-first inspection across correctness, security, readability,
  architecture/lifecycle, and performance; independent host and browser reviews.

The original findings below are retained as historical evidence; their line
numbers refer to the reviewed pre-fix version. No real OAuth account or
credential was used in reproductions or subsequent regression tests.

## Fix verification

| Finding | Resolution | Regression coverage |
| --- | --- | --- |
| 1. Cancelled credential overwrite | Honor abort before storage admission and again inside the serialized callback, before mutation starts | `tests/credentials.spec.ts`: real pi-ai login blocked on a credential lock; abort preserves the old grant; already-started refresh still stores its rotated token |
| 2. RPC null exception | Validate non-null object roots; dispatch only own methods; enforce exact JSON media type and byte limit; decode UTF-8 after concatenation | `tests/rpc-http.spec.ts`: root rejection, prototype method rejection, split UTF-8, request size, sanitized errors, settings-scope round trip |
| 3. Permanent busy after disconnect | Central terminal cancellation clears prompt and timer, aborts, and admits the next attempt | `tests/host-service-lifecycle.spec.ts`: disconnect/remove during prompting followed by another login |
| 4. Work after disposal | Idempotent service disposal cancels owned resources; awaited continuations and route callbacks are fenced | `tests/host-service-lifecycle.spec.ts`, `tests/host-apply.spec.ts`: disposal during port probe, credential reads, login and settings writes |
| 5. Input remount | Stable editor-row identities survive ID edits and patched copies | `tests/client-regressions.spec.tsx`: multi-character typing retains DOM identity/focus |
| 6. Cross-family draft | Key the Add editor by family; cancel abandoned login ownership | `tests/client-regressions.spec.tsx`: switching families clears customized drafts |
| 7. Stale capacity buffers | Key buffers/expansion by row identity; clear them on reset and remove deleted-row entries | `tests/client-regressions.spec.tsx`: delete earlier row and restore defaults after invalid input |
| 8. Locale registration | Call official locale methods with their receiver and own both disposers through Cordis effects | `tests/client-plugin.spec.ts`: actual published SDK registration, Chinese translation, teardown and remount |
| 9. Concurrent login admission | Reserve the actual attempt before awaiting callback-port preflight | `tests/host-service-lifecycle.spec.ts`: concurrent starts, port failure and disposal during preflight |

Additional fixes: rejected submit/cancel RPCs now display localized errors;
closing/switching editors and unmounting cancel unfinished login ownership and
ignore stale responses. Grok discovery receives an owned 30-second abort bound
and is cancelled on disposal. Core boundary, provider/profile and adapter
contracts gained focused suites in `tests/core-boundaries.spec.ts`,
`tests/provider-contracts.spec.ts` and `tests/adapter-contracts.spec.ts`.

The installed locale SDK resolves an older slots namespace type table, so the
fix uses its official single-locale overload once per language rather than a
cast or dependency override. Both calls preserve the receiver and disposer.

The scratch E2E profile now explicitly denies the unused `@google/genai` and
`protobufjs` build scripts, matching the repository policy. No dependency build
script was newly approved. `tests/e2e/oauth-helpers.ts` replaces the shallow
OAuth marker with real browser mutations, on-disk settings assertions, and a
malformed-RPC probe. The large shared smoke file delegates to that helper.

### Current validation

- OAuth: **194 tests across 25 files pass**, with regressions run red before
  fixes. Existing tests were not weakened.
- Full repository typecheck, tests, builds, runtime import checks, README
  pairing and i18n checks pass. The untracked OAuth package was additionally
  checked directly with the runtime dependency checker: all 28 source files
  pass (the normal CLI enumerates tracked packages only).
- All seven packed plugins mount in a real isolated DSH profile; the expanded
  OAuth marker passes typing/focus, family switching, deletion/reset, Apply,
  persisted settings, provider deletion and invalid-JSON-root checks.
- Final full-gate repeat passed: **1,631 tests across 133 files**; all package
  typechecks/builds and documentation/i18n/import checks passed. The complete
  packed-plugin mount smoke passed twice (37.7s and 41.9s).
- Retained screenshot, inspected after the second smoke:
  `test-results/mount.e2e.ts-plugin-family-3f28d-ugins-without-crash-markers/oauth-editor-restored-defaults.png`.
  This is a light-theme runtime test artifact, not a README marketing image.
- Independent reviews approved both host and browser fixes. The host reviewer
  ran 44 focused tests; the client review checked row identity, buffer reset,
  family ownership, locale disposers and stale asynchronous responses. Neither
  found an additional required regression in the changed scope.
- Existing upstream source-map/Vite warnings remain nonfatal. No live account
  sign-in or paid model call was performed, and the plugin remains private.

### Cancellation boundary

Cancellation prevents a queued credential mutation from starting. Once refresh
has begun, its rotated token must still be stored. Likewise, the SDK offers no
rollback for an already-issued `SettingsScope.replace`; it may finish after
teardown, but no further settings write or route publication is initiated by
the disposed continuation. Tests pin these boundaries rather than claiming
that non-cancellable external writes can be undone.

## Original required findings (resolved)

### 1. Critical: a cancelled login can overwrite the stored grant

`packages/dsh-next-oauth-providers/src/host/credentials.ts:63-70`

`CredentialStore.modify` drops pi-ai's third `{ signal }` argument. If an OAuth
login has obtained a grant but is waiting for the credential-store lock, Cancel
rejects the login while the queued mutation can still replace the existing
account's grant. The generation check in `service.ts:356` occurs after SDK
persistence and cannot fence this write.

Reproduced with the real pi-ai `createModels` login and this credential adapter,
using a fake serialized DSH credential store: abort while waiting for its lock;
login rejects `AbortError`; release the lock; the cancelled grant overwrites the
old one.

**Remedy:** accept the store options and check cancellation before scheduling the
mutation and inside the locked callback before invoking `mutate`. Preserve the
SDK's refresh-token rotation semantics once mutation has actually begun. Add a
delayed-lock cancellation regression test.

### 2. Critical: valid JSON `null` escapes RPC error handling

`packages/dsh-next-oauth-providers/src/host/rpc.ts:98-106`

`JSON.parse('null')` succeeds, then `body.method` throws synchronously inside the
request's `end` event, outside the promise catch. This is an uncaught exception
path, not the documented error envelope. Reproduced with a loopback request
fixture by emitting its `data` and `end` events; no HTTP listener was needed.

**Remedy:** validate a non-null object envelope before reading its properties;
reject invalid roots with HTTP 400. Restrict dispatch to own handler keys rather
than inherited object methods. Test `registerRpc` itself, not just its map.

### 3. Disconnect during login leaves the service permanently busy

`packages/dsh-next-oauth-providers/src/host/service.ts:266-273,349-383`

Disconnect increments the attempt generation and aborts its controller but does
not mark it terminal. Both completion branches then skip status updates because
the generation changed. The attempt stays `running`; future `startLogin` calls
reject `busy`, even after the old login has rejected on abort.

Reproduced with a signal-aware fake login: start, disconnect, allow rejection to
settle, inspect `running`, then observe the next login rejected as `busy`.

**Remedy:** centralize attempt cancellation so status, error, prompt rejection,
generation invalidation, and abort happen together. Cover disconnect/remove
while login is running, plus starting the next attempt.

### 4. Plugin disposal does not terminate asynchronous OAuth work

`packages/dsh-next-oauth-providers/src/index.ts:83-90`

Cleanup only unregisters the adapter. The service has no disposal operation;
login controllers, callback servers and the 15-minute timer can outlive the
plugin. Hydration/login continuations can still write settings or invoke route
registration after cleanup.

**Remedy:** give the service an idempotent disposal boundary, cancel timers and
attempts there, and fence hydration/login continuations before persistence or
route updates. Invoke disposal from the Cordis effect cleanup. Test unloading
during hydration and during login. This finding is from lifecycle inspection,
not a live callback-server probe.

### 5. Model ID editing remounts the focused input

`packages/dsh-next-oauth-providers/src/client/ModelListEditor.tsx:177`

The row key includes its editable `model.id`. Each ID keystroke changes the key
and replaces the input, losing focus. Reproduced under real React/jsdom with
source transpiled in memory: after an ID change, the DOM node differs and focus
is no longer on the input.

**Remedy:** assign stable editor-row identities independent of editable values.
Test multi-character typing and focus retention.

### 6. Switching Add-provider family saves another family's draft

`packages/dsh-next-oauth-providers/src/client/SubscriptionsFooter.tsx:228-241`

The unkeyed `ProviderEditor` retains its `models` and `overridden` state when the
family selector changes. Reproduced under React/jsdom: customize a Kimi draft,
switch to Grok, Apply; the RPC receives
`setModels({ alias: 'xai-oauth', models: [{ id: 'kimi-only' }] })`.

**Remedy:** key the editor by family, or explicitly own drafts per family. Test
that switching family cannot save the previous family's catalog.

### 7. Capacity text buffers no longer match rows after delete/reset

`packages/dsh-next-oauth-providers/src/client/ModelListEditor.tsx:69,101-102,221-230`

Capacity input buffers are indexed by row position. Deleting a row shifts the
model list and expanded-row indices, but not the buffers. The surviving row can
show the deleted row's capacity while Apply submits a different numeric value.
Restore defaults likewise does not invalidate the local text buffers.

**Remedy:** use the same stable row identity for expansion and editing state,
and explicitly clear/reconcile buffers when replacing the catalog. Add
edit-capacity/delete-earlier-row and edit-capacity/restore-defaults tests.
This finding is from state-flow inspection.

### 8. Locale registration loses its SDK receiver and hides the failure

`packages/dsh-next-oauth-providers/src/client/index.ts:19-26`

`locale.register` is extracted and invoked without its receiver. The installed
SDK implementation reads `this.dicts`; this invocation throws, and the blanket
catch silently treats it as duplicate registration. The English fallback hides
that neither dictionary was registered, so Chinese translation fails. Returned
registration disposers are also discarded. Reproduced against the installed SDK
in memory: detached registration throws on `dicts`; registration with its proper
receiver translates the Chinese title, and its disposer removes the dictionary.

**Remedy:** use the typed call
`ctx.effect(() => locale.register(NS, { en, zh }))` and remove the broad catch
and signature cast. Test the browser `apply` with the actual locale contract,
Chinese translation, and disposal.

### 9. Callback-port preflight races the single-login admission check

`packages/dsh-next-oauth-providers/src/host/service.ts:210-228`

The busy check runs before the awaited callback-port probe. While a Claude or
ChatGPT start waits for that probe, another family's start can pass the same
check and install an attempt. The first start then overwrites it, leaving two
active logins but only one pollable/cancellable owner.

Reproduced with concurrent Claude/Kimi starts and fake login implementations:
both start promises fulfilled, and both provider logins were entered.

**Remedy:** reserve login admission before the first await and release the
reservation on preflight failure, or serialize start admission. Test concurrent
callback/device-code starts and failed port probes.

## Original coverage and quality assessment

The existing 56 passing tests were not evidence of completeness:

- `tests/host-rpc.spec.ts` tests `createHandlers`, not `registerRpc` HTTP
  envelopes, boundary validation, rejection statuses, size limits or disposal.
- `tests/plugin.spec.ts` never invokes host `apply`; hydration, adapter lifecycle
  and a real settings-scope persistence round trip are not covered there.
- `credentialStoreFrom`, `recordKeyFor` and `denyAmbientAuthContext` have no
  targeted adapter contract tests. Login tests use a memory store instead.
- Service coverage omits prompt exchange/error branches, timeout/lease behavior,
  cancelled queued persistence, and disconnect/remove during login.
- Browser tests exercise add/sign-in, fetching, and auto-close. They do not cover
  browser `apply`, locale registration, editor typing, family switching,
  delete/reset capacity buffers, or rejected submit/cancel RPCs.
- `classifyLoginError` and `pluginConfigSchema` need direct branch/default tests;
  settings/model normalization, `buildProfile`, provider factories and adapter
  delegation have partial coverage rather than exhaustive edge/error coverage.
- The OAuth E2E marker exists in `tests/e2e/mount.e2e.ts:707-735`; it opens Models
  and Add provider and checks the selector, Sign in and Apply. It does not
  exercise authentication or catalog mutation.

Positive boundaries: host imports use official SDK packages; grants have a
plugin-specific credential scope; browser modules do not import host values;
model discovery stays in the owning plugin. No dependency was added or upgraded.

**Consider:** bound Grok discovery requests with a service-owned timeout/signal.
The RPC path currently passes no signal, and a hanging fetch never reaches the
static fallback. No performance benchmark or dependency vulnerability audit was
performed. No shared module or other plugin source was changed by this pass.

## Applied simplification

`packages/dsh-next-oauth-providers/src/host/discover.ts` now uses explicit payload
shape selection instead of nested ternaries/casts, and early returns instead of
three nested discovery guards. No new helper layer, public interface, or behavior
was introduced. Credential reads remain outside the fallback catch; static
fallbacks (including aborted fetches), remote ordering, name precedence and
known-model capacity enrichment are preserved.

`packages/dsh-next-oauth-providers/tests/discover-behavior.spec.ts` adds 15
characterization cases that passed before the refactor and after each step.
Existing tests were not changed. No dead code was introduced or deleted.

## Original simplification validation

- OAuth baseline: 15 files, 56 tests passed.
- With characterization tests, before and after both incremental refactors:
  16 files, 71 tests passed.
- OAuth typecheck passed.
- Existing warnings: vite-tsconfig-paths deprecation and a missing upstream
  ui-primitives source map.
- Full-repository typecheck, tests, build, runtime dependency check, README
  pairing check and i18n check passed. Recursive package suites ran 1,508 tests
  across 124 files. The runtime-dependency checker reports six scanned packages;
  its result is not proof that every OAuth dependency was audited.
- Mount smoke attempted and failed before browser boot: installing the packed
  OAuth plugin into the isolated scratch profile fails with
  `ERR_PNPM_IGNORED_BUILDS` for `@google/genai@1.52.0` and
  `protobufjs@7.6.6`. The scratch profile does not inherit the repository's
  explicit deny-build entries. Resolve that installation-policy mismatch and
  rerun the complete smoke before merge; no build scripts were approved or
  dependency safety policy bypassed. No browser mount result is claimed.
- Normal pnpm invocation attempted automatic dependency reinstallation and
  aborted because there was no TTY. Validation uses
  `pnpm --config.verifyDepsBeforeRun=false` with the existing installed modules;
  no install or lockfile rewrite was performed.
- No live account sign-in, paid model request, or visual UI change was performed.
