# Decisions: provider settings and host interface

The private `@dsh-next/dsh-next-decisions` plugin supplies a bounded inference
module, independent of chat adapters and Squads execution. First-run settings
instructions belong in its [README](<../packages/dsh-next-decisions/README.md>).
The sections below cover additional settings tasks and the developer interface.

## Edit or remove a provider

Open `Settings` → `Models` → `Decision models`. Each saved provider has its own
card. Use `Edit` to change its name, key, and model rows. A custom endpoint URL
can change; the TypeSafe preset URL stays fixed. Leave the key blank while
editing to retain the saved key. Changing the endpoint requires replacing or
explicitly clearing its existing key.

Use `Add model` or a row's remove control to change the model list, then `Save`.
An ID must exactly match the provider's model ID; its display name is optional.
Expand a row to record an advertised input context if known. This is information
for display, not a verified or enforced limit. Saving does not contact the
provider. If another settings edit changed the configuration, refresh and retry.

![Provider editor with explicit model IDs](<../packages/dsh-next-decisions/media/decision-providers.webp>)

Choose `Remove`, then `Remove provider`, to delete a provider and its saved key.
A saved-key indicator shows storage state only, not a successful connection.
The local Web GUI and writable profile settings are required to edit providers.

## Test only when you intend to send a request

`Models and test` lists the saved models. Select `Model to test`, then
`Test decision` to send a fixed sample. **Provider charges and data policies
apply.** A valid response checks protocol compatibility, not factual accuracy or
permission to act. Cancellation does not guarantee provider-side cancellation
or avoided charges.

The first version provides no batch evaluation or durable decision history.
It does not install local models, discover model IDs, or switch automatically
between local and hosted services. Boolean and score questions are not supported.

## Consumer seam

Resolve the Cordis host key `dsh-next-decisions` structurally; the module exposes
`listModels()` and `evaluate(request, signal?)`. Consumers must handle absence
explicitly. Do not import another plugin's runtime implementation. The exported
TypeScript types describe the interface without requiring a runtime value import.

```ts
const result = await decisions.evaluate({
  providerId: 'typesafe',
  modelId: 'jev-1.13.0',
  state: { request: 'I was charged twice.' },
  questions: {
    department: {
      type: 'choice',
      instructions: 'Which category describes the request?',
      criteria: {
        billing: 'Charges, invoices, and payments.',
        technical: 'Technical faults and outages.',
        unclear: 'Insufficient information or neither category fits.',
      },
    },
  },
}, signal)
```

`listModels()` projects only explicitly configured IDs with optional display
names and advertised context limits; it performs no discovery or network
request. One profile supports up to 50 providers, each with 1–100 distinct,
non-empty model IDs. Add/remove model rows edit only the selected provider's
draft; Save commits the entire provider list through the native profile
configuration editor. Display names do not replace IDs in requests. Optional
`contextWindow` values are positive whole token counts up to 1M; they are
provider claims for display only, not verified token budgets or admission
gates. Existing stored `modelIds` arrays migrate to `models: [{ id }]` on an
explicit edit, without losing an old provider before the user changes it. `evaluate()` permits only a configured provider/model pair,
JSON text/object/array state, and 1–16 choice questions with 2–255 options each.
The initial contract intentionally excludes boolean and score outputs rather than
pretending their uncertainty measures are interchangeable.

## Meaning and ownership

Results identify the configured provider, requested model, actual response model,
per-question answers/distributions/provider-derived confidence, available token
usage, and elapsed time. The provider's confidence is not calibrated accuracy for
a consumer's domain. Its distribution is preserved rather than replaced with a
fabricated common confidence metric. Responses must name exactly the questions
and candidates requested, use finite probabilities summing to one within rounding
tolerance, and select a highest-probability candidate.

Consumers own authorized input selection, question and candidate revisions,
uncertainty thresholds, abstention, result freshness, and subsequent actions.
A model result never authorizes an action. Model failure must not silently select
a business fallback branch. This host interface trusts installed host modules; it
is not an isolation mechanism between hostile plugins or a multi-tenant gateway.

## Connection and data handling

Only TypeSafe / System One-compatible `POST <baseUrl>/systemone` is implemented.
There is no chat-model registration, provider-directory registration, OpenAI
compatibility shim, arbitrary browser evaluation RPC, or main-chat model override.
The browser can request only the fixed sample test against a saved model.
This adapter accepts text/JSON state and Choice answers, so its model rows show
Text as the only available input and Choice as the current output. Image is
shown disabled; supporting a future multimodal System One extension needs a
verified media-capable adapter and revised request validation, not an editable
checkbox or a text-only URL. Generated output-token limits do not apply.
The native Models page's provider directory is a chat-route directory, so
Decisions registers only its supported `settings.models.footer` seat. The
footer renders native-style compact cards with a disclosure for model IDs and
the test, and in-card editing. Its hosted add form offers a fixed TypeSafe
endpoint (key required on create and kept fixed on edits) and a custom System
One-compatible endpoint (key optional); both use the same Host inference
interface and retain their
respective drafts while the add mode changes. The mode switch uses the official
segmented-control interface for linked tab panels and keyboard navigation.
A credential dot means a key
is stored, not that the endpoint was contacted. No managed local-model runner,
download, provider-kind registration, or automatic hosted/local fallback is
provided. The custom endpoint permits loopback HTTP only as an existing
low-level development option; there is no dedicated local-model mode.

Provider entries and their explicit `models` records are persisted through the
native config editor in the active profile's `cordis.patch.yml`, the same YAML
configuration mechanism used by other providers in DSH 0.1.7. The retired
`settings.yaml` is not a provider-settings file in this runtime; the plugin
neither writes it directly nor maintains a parallel provider store. Credentials
use the native credential store under the plugin's own namespace. Keys never
appear in state responses. Configuration edits are serialized with optimistic revision
checks; the config-editor callback rechecks its expected provider snapshot.
Credential changes are compensated if the corresponding configuration write
fails. A failed compensation is surfaced, not claimed atomic. External writers
to credential records are not coordinated by this plugin.

Changing a keyed endpoint requires an explicitly replaced or cleared key.
Non-loopback HTTP, URL credentials/query/fragment, and HTTP redirects are rejected.
The local-owner settings RPC requires a loopback peer/Host and, when provided,
a matching Origin host/port; it rejects cross-site browser requests. This does
not provide remote multi-user administration. Provider response/error bodies are
not exposed as UI error text. The plugin retains no request/response history.
The connected provider's own data policy still applies.

## Limits and lifetime

A logical evaluation makes one attempt with no fallback or retry. Limits are
64,000 serialized request characters, 128,000 response bytes, 15 seconds including
queue/credential/fetch/body waits, four active requests globally, and two per
provider. Calls snapshot their JSON inputs before awaiting. Changes/removal cancel
active requests for that provider. Disposal prevents new requests and cancels
in-flight delivery; cancellation cannot guarantee remote cancellation, erasure, or
avoided billing. Browser unmount/cancellation discards late replies.

The configuration RPC accepts at most 128,000 bytes and has a 20-second deadline.
Provider writes already submitted may complete after a browser disconnect; reads
and explicit sample evaluations do not mutate external business state.

## Validation

Pure validation, configuration/credential adapters, host lifecycle, real local
HTTP contracts, and browser wiring have unit tests. The `decisions` E2E suite
uses an owned keyless DSH profile and a local decision fixture; it verifies
multiple providers, per-provider Add model/Remove model rows, the profile YAML
persistence, credential redaction, response shape, sample invocation, and removal. The
family `smoke` suite requires the Models footer marker. These checks do not claim
live Jev accuracy, hosted credentials, or Squads execution support.
