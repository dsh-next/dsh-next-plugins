# Automations plugin: product direction and reuse audit

- Date: 2026-09-09
- Status: proposed; product and deployment decisions need confirmation
- Target: `@dsh-next/dsh-next-automations`
- Scope of this change: research and design only; no plugin, engine, connectors, or UI have been implemented or runtime-verified

## Recommendation

Build a business-process product, not a cron wrapper around chat and not an n8n clone.
The promise should be: **Describe a process, test it on examples, approve what it
may do, and know what happened when something needs attention.**

Use a deterministic, durable process around bounded agent steps. Agents interpret,
extract, research, and propose; explicit action steps control external writes.
Durability and output quality are separate: a process can resume perfectly and
still make the wrong decision. Both need independent release gates.

**Provisional first owner-facing release:** one trusted operator, one template,
manual runs, test examples, and one approval-required connector action, with a
run history and attention inbox. First prove the runner against a harmless test
destination; that engineering proof is not a customer release. Scheduling and
a small connection catalog follow the core proof. Confirm the
[three owner decisions](#decisions-needed-from-the-product-owner) before selecting
the engine or real connector. If shared users are required from day one, the
[company-readiness prerequisites](#security-and-company-readiness) move into the
first release rather than being postponed.

Start with one real process and one accountable owner. An operations manager
handling incoming requests is the working persona, not a researched conclusion.
A support-triage workflow is a safer initial example than autonomous payments:

1. Receive a request through a manual test or authenticated event.
2. Extract a structured summary, category, urgency, and evidence from approved sources.
3. Apply explicit business rules and route missing or ambiguous information to a person.
4. Draft a response or record update.
5. Show the exact change to a reviewer.
6. Apply the approved action through a connector with a documented retry contract.
7. Verify the external result and retain a receipt.

No autonomous payments, bulk deletion, employment decisions, or unrestricted
outbound messaging in the first pilot.

## Product approaches considered

| Approach | Useful property | Main limitation |
| --- | --- | --- |
| Scheduled prompt and run history | Fast setup for summaries and reminders | Weak control over multi-step effects and recovery |
| Visual node canvas first | Explicit data flow for technical builders | Non-technical users still have to design a program |
| Plain-language setup plus editable process cards | Fast creation with visible, testable behavior | Requires a constrained definition and good validation |
| Teach by demonstration | Captures existing work rather than asking users to formalize it | Browser actions are fragile; demonstration is not a policy or an eval |
| Review-only assistant | Removes risky autonomy; useful before connectors are ready | A person still performs the final action |
| Evals and agent steps for existing n8n workflows | Reuses a company's existing integrations and execution infrastructure | Two systems, credential arrangements, and audit trails to operate |

Prefer process cards. Test usability first in review-only mode, where a human
performs the final action; the first executable pilot adds approval-required
connector actions. Offer an n8n bridge if pilot users already have workflows there.
Defer a graph editor and demonstration capture until evidence shows the simpler
builder is insufficient.

The riskiest assumption is that users can express correctness and exceptions,
not that a model can draft a workflow. Test that cheaply with a clickable builder
and representative historical requests: can the owner find a bad proposed action,
explain the expected outcome, and resolve a failed run without a developer?

## Experience for non-technical users

### Create and publish

1. **Describe the job** or select a template. Ask about the trigger, desired
   outcome, connected apps, limits, and what needs review.
2. **Review the process** as ordered cards: When, Gather information, AI task,
   Check, If/otherwise, Ask for approval, Take action, Wait, Finish. Show only
   the supported subset in each release.
3. **Connect apps** through administrator-approved connections. Users choose
   recognizable accounts and fields, not environment variables or JSON paths.
4. **Test with examples** using uploaded or curated inputs. Show expected and
   actual results, proposed external actions, and plain-language failures.
5. **Publish a version** only after checks pass. Display the action permissions,
   reviewers, run limits, schedule timezone, and missing prerequisites.
6. **Operate from an inbox**: Needs approval, Needs information, Connection
   expired, Action outcome unknown, Failed. Offer a specific next action.

Chat generates a draft; it never silently publishes it, grants permissions,
adds a connection, or changes a live run. Natural-language edits become visible
version diffs. Field pickers expose previous-step outputs as friendly names.
Advanced JSON and expressions are optional; arbitrary generated JavaScript is
not the canonical process definition.

### Main views

- **Automations:** owner, enabled version, trigger, recent outcomes, next run,
  and a conspicuous worker-offline warning.
- **Process:** ordered cards and a human-readable permissions summary.
- **Test examples:** datasets, failures, comparisons, and publishing readiness.
- **Runs:** business outcome first; expand into step attempts, checks, external
  receipts, token usage, and the linked Harness conversation.
- **Needs attention:** durable approvals and incidents, not transient toasts.
- **Connections:** permitted accounts, scopes, health, and reconnect actions.

Use progressive disclosure: a business user should not need to learn DAGs,
leases, checkpoints, or LLM-as-judge to operate the product. Do not hide uncertainty
behind a green “agent finished” badge. Execution status and quality status are
separate fields.

## What the inspected stock Harness offers

### Audit scope

The supplied location is an **installed npm distribution**, not a full source
monorepo. Its manifest reports `@deepseek-ai/dsh@0.1.3-alpha.2`. The audit used
shipped implementation JavaScript and public TypeScript declarations under:

`/Users/rokgrabnar/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/`

Evidence paths below are relative to that directory. Package availability does
not prove that a user's chosen profile mounts it. Confirm injection and behavior
in the actual target profile before committing to a dependency. Absence findings
are limited to the inspected installed modules, not every unreleased upstream branch.

| Need | Reuse candidate | What the plugin still owns |
| --- | --- | --- |
| Agent execution | `dsh-agent`, `dsh-agent-loop`, `dsh-subagent`; scoped agent handles and validated structured child results | Step identity, business validators, bounded tools, completion correlation, run recovery |
| Models and tools | `dsh-llm` and providers, `dsh-tools`, `dsh-mcp-client`, skills/presets | Approved connector catalog, business schemas, effect classification, provider-specific error handling |
| Session evidence | `dsh-session`, JSONL persistence, projection/query, attachments, stats | Authoritative automation ledger; redacted business audit and retention policy |
| Permission prompts | `dsh-user-approval`, user questions, sandbox policy | Durable business approvals, reviewer identity, expiry, separation of duties, exact action binding |
| Local configuration/state | `dsh-settings`, `dsh-storage`, `dsh-storage-domain`, `dsh-storage-json` | Transactional admission, steps, inbox/outbox, uniqueness, leases, migrations |
| Scheduling | `dsh-schedule` session reminders | Session-independent schedules, timezone/DST rules, persisted occurrence admission and catch-up policy |
| Inbound events | `dsh-webhook`, GitHub adapter, host web server | Authenticated durable inbox committed before acknowledgment; duplicate/replay protection |
| Workflow execution | `dsh-workflow`, worker-thread implementation, workflow tools | Durable orchestration; do not equate stored workflow UI history with resumable execution |
| Background work | `dsh-jobs`, `dsh-jobs-local` | Persistent runnable queue and crash recovery; live job handles are not a workflow engine |
| Credentials | `dsh-credentials` reference/record interface, local provider | Connection scopes, organizational ownership, refresh/revocation policy, production secret-store adapter |
| Telemetry | `dsh-session-telemetry`, stats, trajectory views | Continuous automation spans, business metrics, privacy filters and approved exporters |
| Browser integration | Locale, slots, theme, primitives, settings sections, conversations | Builder, eval UI, run timelines and attention inbox |
| Evals | Session/tool/model evidence provides useful raw material | No ready business-automation dataset/scorer/regression/publish-gate suite was identified; build this layer |

### Important non-equivalences

- A persisted chat log is not a transactional business-process ledger.
- A finished agent turn is not proof that a business task succeeded.
- `whenIdle` describes agent quiescence, not completion of one particular submitted
  message. Correlate session events, turn identity, and the expected typed output.
- The stock schedule model uses after/at/every reminders tied to a root session.
  One-shot at already supports IANA timezones and specific DST behavior, and every
  has a five-minute minimum. It needs a live owner, handles overdue reminders on
  resume, and coalesces repeat intervals; it is not a global calendar-cron engine.
- Stock webhook dispatch is fire-and-forget. A 202 response must not be treated as
  proof of a durably accepted automation event. A plugin-owned route can reuse the
  host transport but must persist admission before acknowledging.
- Worker threads improve containment, not crash recovery or multi-machine availability.
  The shipped workflow VM is explicitly escapable, not a security isolation mechanism.
- Stock session event append accepts in memory; automation receipts that depend on
  session history need an awaited `ctx.sessions.flush(session)` and an active durable
  persistence participant. Transcript recovery distinguishes tools not started from
  tools with unknown outcomes; it does not replay unknown effects safely for us.
- Continuable subagents can cold-resume a saved child identity. Goals persist state
  but intentionally require human rearming after resume. Neither is an unattended
  durable workflow engine. Do not repurpose goal/Ralph authority as business scheduling.
- The stock SQLite session-query database is a disposable projection/cache with an
  owned schema. Do not add automation tables to it or treat it as generic storage.
- Storage domains serialize writes inside one process and expose useful small-state
  persistence, but not cross-record transactions or cross-process compare-and-swap.
- The stock atomic-file helper guarantees reader-visible replacement, not fsync-based
  crash durability. Storage JSON replacement is stronger, but its per-record
  deletion/backup paths and skip-on-corruption behavior must not back an authoritative
  process ledger without additional handling.
- The local credential provider stores a YAML document; credential references and
  wire redaction must not be described as encryption at rest.
- The inspected OTel exporter is feedback-triggered/on-demand, not a general
  always-on automation audit pipeline. Its redaction extension needs actual rules.
- The browser has real instance authentication: a launch token exchanges for an
  authority-bound HttpOnly cookie. This is not a per-person identity/RBAC system.
  Raw host-webserver registrations do not automatically inherit that protection;
  use the authenticated connection routing seam or explicit request rejection checks.
  `dsh-authorization` manages credential acquisition, not company permissions.

### Compatibility and repository reuse

The repository currently uses mixed SDK generations: several agent/session/tool
peers are `0.1.2-rc.1`, legacy client-runtime peers are `0.1.1-rc.2`, and some
newer model/credential/settings dependencies are `0.1.3-alpha.2`. Do not blindly
copy an existing plugin's dependencies and assume they match the inspected runtime.
Resolve exported types and verify actual browser module availability for the
chosen minimum DSH version without broad, unrelated dependency upgrades.

Reuse the repository scaffold, shared build preset, three-zone layout, locale
pattern, and test harness. The Skills plugin demonstrates an additive settings
section; the Notifier demonstrates event observation and same-origin host routing.
These are patterns to learn from, not cross-plugin value imports or a ready-made
security layer. In particular, an automation must fail a persistence error rather
than silently fall back to in-memory success. Existing skills and notifications
may be optional integrations through explicit Cordis interfaces; do not assume a
notification extension interface exists just because a notifier plugin does.

No DSH distribution or source checkout changes are required or proposed.

## Execution architecture

`Trigger -> durable admission -> pinned process version -> durable steps -> checks/approval -> external action -> verified receipt`

### Definition and runtime are separate

The definition is a schema-validated, versioned data document. The builder and
human editor produce the same document. The publisher rejects unknown step kinds,
missing references, unsafe tools, incompatible schemas, invalid connections,
unbounded loops, and absent mandatory checks. Start with sequences and simple
branches rather than an arbitrary executable language.

Every admitted run pins its definition, instructions, model settings, skill/content
snapshot or resolvable version, tool schema/adapter versions, permission policy,
and evaluation contract. Live edits affect future runs only. Retain old executable
versions while runs need them; otherwise hold the run for an explicit migration.
Credential **references** are pinned; secret values are not copied into history.
Rotation and revocation still take effect. Model aliases can drift: record the
resolved provider model when available and do not promise reproducible generation.
Pinned permissions are a ceiling, not irrevocable authority: current stricter policy,
revoked connections and emergency stops apply to already-running work before each
step/tool dispatch. A historical approval cannot preserve a newly revoked privilege.

### Choose the engine after choosing the deployment

| Deployment | Recommended direction | Honest guarantee |
| --- | --- | --- |
| Private local pilot, one trusted operator/host | Plugin-owned transactional SQLite ledger and one worker, with kill/restart tests | Recovery after process restart with intact durable storage; no execution while the machine is asleep/offline; no HA |
| Shared, always-on company operations, multiple workers | Evaluate Temporal as the durable engine; Harness agent turns and connectors run as activities | Established orchestration infrastructure, but still needs idempotent effects, auth, operations, and tested adapters |
| Company already operates n8n | Consider n8n as outer orchestration and expose bounded Harness tasks/evals | Avoid rebuilding existing integrations; settle ownership of retries, credentials, and run state explicitly |

Do not implement two engines speculatively or claim that moving a SQLite file to
a network share enables distributed execution. For the local route, select and
verify a maintained SQLite driver against the pinned Node/toolchain and packaging;
stock session-query internals are not an importable generic database module.
For Temporal, keep nondeterministic model/tool calls in activities, not replayed
workflow code. A deterministic process definition is not deterministic AI output.

### Deep modules and seams

Keep one package initially. Proposed modules, not SDK names:

- **Process definition:** validate and publish immutable definitions, hiding
  schema evolution, dependency resolution, and safety/eval readiness checks.
- **Execution:** admit an event, signal a run, and query its state; hide claims,
  transactional transitions, timeouts, retry scheduling and recovery inside it.
- **Agent task adapter:** run one typed, bounded task against Harness; owns scoped
  setup, event correlation, output validation, timeout and disposal. Prefer
  `ctx.subagents.start` with `outputSchema`, `toolFilter`, depth/model limits and
  cancellation under an owned automation parent where supported by the target SDK.
  Check `stopReason` and the structured receipt; retain diagnostics. Stock structured
  capture is validated, but supports a restricted object-root JSON Schema subset:
  use explicit business validators for ranges, formats and cross-field rules.
  Do not silently accept partial text or a generic workflow helper returning null
  after a child failure as a successful task.
- **Action adapter:** execute or reconcile one named business effect; exposes its
  input/output schema, required scopes, retry safety and test fixture behavior.
- **Evaluation:** evaluate a candidate against a versioned suite and compare it
  with a baseline; hide scorer execution and per-case evidence aggregation.

The production Harness adapter and deterministic fixture adapter justify a real
testing seam. Do not add an abstract engine framework merely because a second
engine might be useful someday. Host and browser cross a validated Cordis/host
interface; authorization applies to every read and mutation, not only UI controls.

### Minimum persisted facts

Keep definitions/releases, admitted trigger events, runs, step attempts and
outputs, business effects/receipts, approvals, next wake-ups, an outgoing event
queue, and evaluation suites/results. Large artifacts are referenced from an
appropriate artifact store with integrity and retention metadata.

Scope every record and uniqueness key to the deployment/workspace or organization
as applicable, with explicit owner identity. A workspace scope is organizational
filtering in the local pilot, not a security isolation guarantee. Its authenticated
actor is the trusted instance operator; do not attribute an approval to a named
employee or claim separation of duties without an actual identity system.

### Reliability contract

1. **Durable admission:** commit the dedupe key, pinned version, and runnable work
   before an event is acknowledged. Duplicate deliveries return the existing
   admission. Polling connectors persist cursors consistently with admitted work.
2. **Single effective owner:** use atomic claims, expiring leases and fencing
   tokens; stale workers cannot commit results. Stop work on lease loss. Leases
   alone cannot prevent a stale external request: connector idempotency or
   reconciliation remains required.
3. **Checkpoint explicit steps:** persist validated outputs and chosen branches.
   Resume from committed state, never regenerate completed AI decisions or replay
   completed effects just because the agent's transcript is available.
4. **Classify effects:** reads may retry within limits; writes require a stable
   logical-effect idempotency key reused across attempts and recovery. Record intent
   before invoking the destination and a receipt after. An outbox does not create
   exactly-once delivery to an arbitrary external system. Where a business operation
   must happen only once, use its domain identity as well as the trigger identity;
   two distinct event IDs can still describe the same invoice or request. A safe
   retry/resume keeps the effect identity. An intentional new run requires an
   explicit duplicate-action decision, not an automatic fresh key for every attempt.
5. **Handle unknown outcomes:** if the destination accepted a write but the worker
   died before storing its receipt, reconcile by destination idempotency key or
   external identifier only when the adapter documents authoritative reconciliation
   or destination-enforced uniqueness. A not-found lookup is not proof of failure:
   a timed-out or stale request might still apply later. Document the destination
   idempotency/uniqueness retention window and bound automated recovery to it. An
   expired key, negative-but-inconclusive lookup or missing guarantee stays unknown
   in Needs attention. Never blindly retry an unknown payment, email, or record
   creation, and never rotate its effect key to bypass the unknown outcome.
6. **Bound retries:** classify transient failures, respect Retry-After, back off
   with jitter, and persist the next attempt time. Auth failures, schema failures,
   denied permissions and business rejections do not receive blind network retries.
   One layer owns retry budgets so provider/agent/workflow retries do not multiply.
   Exhausted attempts enter a visible failure/attention state; they are not dropped.
7. **Durable waits:** approvals and timers consume no active agent promise or worker
   while waiting. Resume only after a persisted signal or deadline transition.
8. **Bind approvals:** record the action digest, exact recipient/account/arguments,
   reviewer identity, policy/definition version, expiry and decision. Approval is
   one-use and server-enforced: bind it to the run, step and logical effect, and
   atomically consume it into that effect's persisted intent. It cannot authorize
   a second effect or another run, even with identical arguments. Safe retries use
   the same intent and effect key, not another consumption of the approval. Before
   every write attempt, recheck current policy, approval expiry/revocation and
   destination preconditions; expired authority waits for reapproval. Read-only
   reconciliation may continue under valid read permissions after write authority
   expires. Reapproval does not make an unknown outcome safe to resend. Material
   input changes invalidate approval and require a newly reviewed intent.
9. **Bound autonomy:** time, tokens, tool calls, steps, fan-out, concurrent runs and
   estimated spend are limited. Reserve budget across concurrent work. Record
   usage and flag unknown pricing rather than claiming an exact cost cap.
10. **Define time semantics:** timezone, DST behavior, missed occurrences and
    overlapping runs are explicit. Default to no overlap and bounded coalescing,
    not an unbounded catch-up burst. Persist occurrence identities and next due time.
11. **Recover and stop honestly:** cancellation stops future steps, not effects
    already applied. Reconciliation may still be required. Compensation is an
    explicit, possibly approval-gated action, never “undo” of an arbitrary workflow.
    Rollback selects an older release for new runs; it does not reverse old effects.
12. **Operate the storage:** test backup/restore, migrations, full disks, retention,
    corruption handling and worker restarts. Browser close/reload does not own
    execution. Offline workers must be visible, not silently called healthy.

The advertised guarantee is **at-least-once attempts with deduplicated admission
and effect-specific idempotency/reconciliation**, not universal exactly-once
business effects. It is conditional on the chosen deployment and storage health.

## Evals as part of the product

Business users see **Test examples** and **Quality checks**, not an empty metrics
console. Every template includes examples of success, ambiguity, missing data,
unsafe requests, and connection failures. Users can edit expected outcomes and
convert a redacted production failure into a regression case.

Use the same process runner with fixture action adapters in tests. No live write
credentials are available in this mode; tools, MCP, shell and browser access must
not bypass it. Testing is not a prompt that asks the model to avoid side effects.
Live, read-only shadow evaluation requires explicit opt-in and separate budgets.

| Evaluation layer | Examples |
| --- | --- |
| Deterministic contract | Required fields, data types, allowed categories, totals, IDs, recipient restrictions, no prohibited action |
| Business outcome | Correct routing, successful reconciliation, requested record really exists, human correction required |
| Grounding and quality | Facts supported by retrieved records, useful summary, missing information disclosed |
| Tool trajectory and safety | Only approved tools/accounts, required check before action, no secret leakage or policy bypass |
| Operational reliability | Retries, restarts, duplicate events, deadlines, latency and cost bounds |

LLM judges are optional advisory scorers with a versioned rubric, model and
configuration, evidence and calibration against human labels. Keep judges
unprivileged. Judge disagreement or failure is not a pass, and a judge never
authorizes an external action. Do not trust self-reported model confidence as a
permission gate.

A suite versions its inputs, labels, fixture data, grader configuration and
baseline. Pin all of these to each eval run. Maintain held-out cases, add
adversarial/prompt-injection cases, repeat stochastic cases where useful, and
report denominator and uncertainty instead of presenting 10/10 examples as proof
of production safety. Prevent customer-sensitive examples from leaking into
unapproved models or other workspaces.

Publishing requires deterministic safety checks to pass and workflow-specific
quality thresholds agreed with the owner. Safety-critical failures cannot be
averaged away by a high mean score. Invalidate readiness after material changes
to instructions, models, tools, policies or fixtures. Roll out through draft,
fixture test, optional read-only shadow, limited review-required pilot, and only
then selectively autonomous operation. Sample production quality, alert on
regressions, and allow an explicit pause/rollback of future admissions.

Keep business metrics alongside execution metrics: accepted outcomes without
correction, harmful/duplicate effects, approvals/overrides, recovery time, queue
lag, run latency, usage and cost estimates. Business time saved needs a measured
manual baseline, not a guessed dashboard number.

## Security and company-readiness

- Default agent steps to read-only scoped tools. Allowlisted connector actions own
  writes; arbitrary shell, dynamic Cordis/code tools, unrestricted web requests,
  computer use and subagent spawning are off unless separately justified. Stock
  `run_code` can remain a reserved transport; enforce the allowlist at target-tool
  dispatch with deny-only guards, not merely by hiding tool names. Restriction masks
  cover inherited tools, so audit scope-owned registrations and child policy too.
- Treat incoming emails, documents, retrieved pages and tool output as untrusted
  data. They cannot alter process permissions, destinations or the published plan.
- An MCP tool is not automatically a safe business connector. Classify effects,
  restrict arguments and destinations, and test each adapter's retry behavior.
- Protect ingress with signatures/authentication, payload limits, rate limits,
  replay windows where supported and durable dedupe. Restrict outbound URLs and
  redirects to prevent SSRF; server-side policy is authoritative.
- Separate test and live connections. Resolve credentials host-side; never include
  secrets in process definitions, browser payloads, prompts, traces or eval exports.
- Reuse credential interfaces but choose approved encrypted storage/key management
  for shared deployments. Define credential ownership, rotation and revocation.
- Define creator, publisher, operator, reviewer and administrator permissions for
  a shared product, plus separation of duties where required. Identity, tenant
  isolation and server-side authorization are prerequisites, not polish after launch.
- Stock workspace-write confinement is a file-write policy, not network, secret-
  read or SaaS-write isolation. Mutually untrusted users, plugins or native code need
  stronger process/OS isolation and outbound controls, not just a workspace selector.
- Reuse platform sandbox and permission enforcement without weakening them. A
  durable business approval does not silently override a Harness security denial.
  Missing approval channels fail closed or leave the process awaiting a reviewer.
  Stock one-shot approval requests require an open agent turn and are not durable
  pending business approvals; the automation ledger owns long waits and approver identity.
- Redact payloads before storage/export as well as display; define retention,
  deletion, audit access, model data policy and backup access, including the
  underlying Harness session logs rather than only the automation projection. A
  telemetry export redaction hook does not redact the original session log. An append-only local
  table is not independently tamper-proof compliance evidence.
- Do not expose the existing local GUI or plugin routes to the public internet as
  an incidental part of this work. A local single-user pilot is not a multi-tenant
  SaaS or a certified enterprise deployment.

## Native Harness integration

For the private pilot, an additive `settings.section` named Automations is a
verified mounting seam, matching the repository's Skills pattern. The daily-use
product may deserve a dedicated work surface later; a sidebar footer action and
shell overlay are public additive seats to investigate. Do not replace the
occupied root sidebar or conversation slots to simulate a new route.

The adjacent stock Plugins page establishes a 760px reading column, 12px section
gaps, an 18px/600 heading, 13px intro, and an underline tab strip with 22px gaps,
13px/20px text and 0.5px separators. Those values were read from its installed
CSS bundle, not inferred from a screenshot. Browser implementation must use the
platform theme, primitives, locale and lifecycle; no separate design system.

Keep thin entries and the repository's `src/core`, `src/host`, `src/client`
zones. Follow the owning [plugin conventions](../plugins.md),
[package structure](../package-structure.md), and [locale contract](../i18n.md).
Scaffold a private package when implementation starts. No release changeset names
a private package. UI work later needs real mount tests, keyboard/light/dark
checks, and screenshots; none were performed for this design-only change.

## Delivery plan and acceptance gates

### 0. Validate the product and execution seam

Confirm the first process, users, allowed effects, target deployment and expected
volume. Pin the target SDK/profile and prove: create a scoped agent, deny unsafe
tools, capture a correlated typed result, dispose it safely, and mount an additive
UI without disturbing current plugins. Test failure to create/resume as well as
success. Decide local ledger versus an existing engine before building the runner.

### 1. Private engineering proof

One template, manual trigger, immutable versions, one bounded agent step, a
schema/rule check, fixture-mode evals with basic publish safety gates, a durable
approval, one vetted action adapter, and a run/attention view. Persist state and prove kill/restart recovery before
adding a visual builder or multiple connectors. Use a harmless test destination;
no real customer actions in automated verification.

### 2. First owner-facing pilot

Promote the proven template to a trusted-operator pilot with its selected real
connector and explicit approval-required actions. Then add authenticated durable
webhooks and simple timezone-aware schedules, missed-run
and overlap policy, a small connection catalog, review notifications backed by an
outbox, baseline comparisons, richer promotion gates and operational health. Choose the
actual apps from the first process, not from a promise to support every SaaS app.
Prove that a non-technical owner can build, test and resolve failures unaided.

### 3. Shared company deployment

Add the chosen identity/authorization and secret-management system, deployment
operations and backup/restore, scaled execution if needed, production sampling and
staged rollout. Verify environment promotion remaps connection references and
requires fresh authorization rather than copying production secrets into tests.

Defer arbitrary graphs/loops, a marketplace, imported executable workflow code,
self-modifying live plans, unsupervised computer use and general multi-agent teams.

### Required verification matrix

| Public behavior | Evidence required before shipping |
| --- | --- |
| Validate, edit and publish | Exhaustive core tests, rejected schema/graph/policy cases, stale revision conflicts, old-run version pinning |
| Admit and schedule | Duplicate deliveries, bad signatures, acknowledgment-before/after commit, DST/missed/overlap cases, cursor recovery |
| Execute and recover | Kill at each transition, completed-step reuse, lease expiry and stale-worker fencing, timeout/retry budgets, full disk |
| Apply effects | Destination idempotency, accepted-write/lost-receipt, late acceptance after lease loss, inconclusive negative lookup, expired-key recovery, no duplicate effect on safe resume |
| Wait, approve and cancel | Restart while waiting, unauthorized/expired/duplicate decisions, altered action digest, cross-run authorization replay, crash between authorization and send, revocation during retry, cancellation/approval races |
| Run agents | Correlated result, invalid/missing output, credential expiry, tool denial, policy inheritance, safe disposal and restart attachment |
| Evaluate | Isolated fixture mode, no write escape, rubric/fixture versioning, judge error/disagreement, regressions and publish-gate invalidation |
| Protect and observe | Cross-scope access denial, secret redaction, prompt injection/SSRF cases, budget concurrency, restore and retention |
| Host/browser interface | Exact RPC envelopes and errors, auth checks, persistence round-trip, jsdom wiring/reconnect/dispose, bilingual copy |
| Actual plugin mount | Packed real-shell DOM marker covering draft -> test -> approval/run, browser reload, existing-plugin regression gate and screenshots |

Map every exported behavior and edge/error branch to tests under the repository's
completeness contract. A happy-path demo or mocked timeout does not prove crash
durability. Run the full repository gates and real-mount lane when runtime code
exists; this proposal cannot substitute for those checks.

## Decisions needed from the product owner

1. Who owns the first process, which process is it, and which apps does it touch?
   What exceptions or costly mistakes occur in today's manual version?
2. Is the first target a private/local Harness installation or a shared, always-on
   company installation? What uptime, volume and data-residency requirements apply?
3. Which actions may run unattended, which require approval, and who may approve?

These determine the smallest honest pilot. The research below treats both xAI's
Grok Bot and Grok Automations as inspiration; clarify if a different “grok bot”
was intended.

## Evidence and inspiration

### Public sources consulted

- [Grok Automations](https://x.ai/news/grok-automations): natural-language setup,
  templates, schedule/email triggers, Run now, notifications and conversation
  history per run. Borrow the low-friction setup, not an unverified durability claim.
- [Grok Bot](https://x.ai/bot): delegated jobs, approval handoffs, routines taught
  by demonstration and role-oriented bots. These are product claims, not evidence
  of business-effect idempotency or a reason to enable unrestricted computer use.
- [n8n evaluations](https://docs.n8n.io/build/integrate-ai/test-and-improve-ai-workflows/understand-why-to-test):
  example datasets, expected outputs, prompt/model comparisons and production
  failures as regression cases. Put quality checks in the main authoring flow.
- [n8n human review for tools](https://docs.n8n.io/build/integrate-ai/ai-examples/human-in-the-loop-for-tools):
  selective approval of the exact tool and parameters through reviewer channels.
- [n8n queue mode](https://docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode):
  separation of ingress, persisted executions and workers; this has real deployment
  infrastructure and is not just another timer in the browser.
- [Temporal activity definition](https://docs.temporal.io/activity-definition):
  an activity can execute more than once, including when the worker dies after
  the external action but before reporting completion. Destination idempotency
  and appropriately granular activities remain necessary.
- [LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence):
  checkpointed state versus cross-thread memory, and the explicit warning that
  in-memory checkpoints do not survive restart.
- [LangGraph fault tolerance](https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance):
  per-node retry/timeout/error handling. Borrow bounded recovery, without adding
  a second agent framework merely for feature parity.

### Local source evidence

Line references describe the inspected installed build, not stable upstream URLs.

- Agent factory/scoped setup: `dsh-agent/lib/types/index.d.ts:34-104`.
- Fail-closed permission contract and session policy:
  `dsh-user-approval/lib/types/index.d.ts:1-46,57-95`.
- Typed bounded child contract: `dsh-subagent/lib/types/types.d.ts:122-191,239-317`;
  structured capture: `dsh-subagent-in-process-driver/lib/index.js:36-108,194-250`.
- Schema subset: `dsh-tools/lib/types/json-schema.d.ts:1-48,83-105`;
  tools restriction/guard interface: `dsh-tools/lib/types/index.d.ts:574-676`.
- Session flush contract: `dsh-session/lib/types/index.d.ts:51-71` and
  `dsh-session/lib/index.js:1435-1463`; interrupted tool outcomes: same JS, 477-575.
- Session scheduling: `dsh-schedule/lib/index.js:192-234,274-303,368-397,1450-1488`;
  workflow live handles: `dsh-workflow/lib/types/runtime-types.d.ts:15-43`;
  live jobs: `dsh-jobs/lib/types/index.d.ts:1-5` and
  `dsh-jobs-local/lib/index.js:101-106,406-428`.
- Continuable cold resume: `dsh-subagent/lib/index.js:1767-1812`;
  goal rearming: `dsh-goal/lib/index.js:577-588`.
- Fire-and-forget dispatch: `dsh-webhook/lib/index.js:248-270`;
  immediate GitHub acknowledgment: `dsh-webhook-github/lib/index.js:139-145`.
- Domain interface: `dsh-storage-domain/lib/types/index.d.ts:16-19,83`;
  in-process write serialization and backend-first commit:
  `dsh-storage-domain/lib/index.js:221-225,257-285`.
- JSON atomic replacement: `dsh-storage-json/lib/index.js:25-51`;
  process-local handle ownership: `dsh-storage-json/lib/index.js:553-580`.
- Atomic-file durability disclaimer: `dsh-atomic-write/lib/index.js:45-76`;
  JSON per-record deletion/backup: `dsh-storage-json/lib/index.js:467-485`.
- Disposable SQLite projection/schema ownership:
  `dsh-session-query-sqlite/lib/index.js:9-13,50-80`.
- Credentials layering and file representation:
  `dsh-credentials-local/lib/types/index.d.ts:1-34,67-75`.
- Instance authentication: `dsh-client-connection/lib/types/index.d.ts:14-40`
  and `dsh-client-connection/lib/index.js:201-245,291-363,386-440`;
  raw routing: `dsh-host-webserver/lib/types/index.d.ts:30-58,84-106`;
  credential-acquisition role: `dsh-authorization/lib/types/index.d.ts:70-115`.
- Sandbox scope: `dsh-sandbox/lib/types/index.d.ts:1-46,121-140` and
  `dsh-fs-sandbox/lib/types/index.d.ts:1-24`.
- OTel feedback-only config and on-demand coordinator:
  `dsh-session-telemetry-otel/lib/types/index.d.ts:19-50,63-80` and
  `dsh-session-telemetry-otel/lib/index.js:137-186`.
- Additive settings sections:
  `dsh-client-ui-settings/lib/types/client/contract/slots.d.ts:56-71`;
  additive sidebar action:
  `dsh-client-ui-sidebar/lib/types/client/contract/slots.d.ts:54-62`.
- Occupied shell slots and additive overlay:
  `dsh-client-ui-layout/lib/types/client/index.d.ts:19-80`.
- Native page CSS: `dsh-client-ui-settings-plugins/lib/client.js:377`;
  field CSS: same file, line 13.
- Repository integration examples:
  `packages/dsh-next-skills/src/client/index.ts:115-129` and
  `packages/dsh-next-notifier/src/index.ts:17-47`.
