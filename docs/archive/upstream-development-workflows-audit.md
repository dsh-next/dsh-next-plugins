# Development workflow audit: DeepSeek Harness and dsh-next

## Executive assessment

**Keep your plugin architecture and packed-runtime verification. Simplify the work required to change a plugin, and make the remaining checks more trustworthy.** The highest-value upstream lesson is not its number of scripts, packages, or rules. It is matching verification to the changed behavior, testing the actual shipped entry path, and assigning one owner to each resource and fact.

Your repository already has several strong choices: independent Changesets releases, official npm SDK consumption, a single browser build preset, isolated DSH homes, credential separation, content-addressed tarballs, and real GUI mount checks. Do not replace these with upstream's internal build and test infrastructure.

The immediate problems are more concrete:

1. **The configured CI runtime cannot load the current full plugin family.** The tested DSH pin is older than the Git plugin's minimum.
2. **Agent guidance and tooling have drifted.** Some prescribed commands are invalid, and several documents repeat different versions of the verification procedure.
3. **Some strong policy claims exceed what the gates enforce.** “Complete testing,” English UI localization, and README code/link parity are not mechanically established by the current gates.
4. **The development loop repeats work.** Build, pack lifecycle, full local checks, and CI overlap; the safe runtime runner itself is worth retaining.
5. **Shared presentation is maintained by coordinated copying.** Replace that selectively with platform primitives and build-time sharing—not a new runtime framework.

Recommendations below are proposals, not changes to current repository policy.

## 1. Scope, evidence, and limitations

### Revisions inspected

- Official repository: [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness), shallow clone at commit [`ddefc45fbc7f8e46dd73185e68295696d1297887`](https://github.com/deepseek-ai/deepseek-harness/commit/ddefc45fbc7f8e46dd73185e68295696d1297887), advertising `0.1.6-alpha.2`. Upstream links below are pinned to this commit.
- Local committed baseline: `c5dd14dacddf110027077d6c4c875dc8f59b9c42`, plus the existing working tree. Inspection took place on 2026-09-20 UTC.
- The local working tree already contained substantial Git-plugin changes and continued changing during investigation. Findings involving that work are explicitly identified; local line anchors are inspection-time locations, not immutable commit references.
- Inventory from `git ls-files`: eight local package manifests under the package tree versus 298 upstream; seven local repository skills versus twelve upstream. Those package counts include support/fixture manifests and are scale indicators, not published-package counts.

This was a source-backed development-process investigation, not a full product/security audit or a runtime UI review. It included actual runner implementations, test examples, manifests, build presets, CI, skills, and instruction files—not just README comparisons. No upstream dependency installation, live-model calls, full package test run, browser run, or timing benchmark was performed. No installed DSH source, plugin source, workflow, or existing user work was modified.

### Checks actually performed

| Check | Observed result |
| --- | --- |
| `pnpm run test:scripts` | 185 tests passed, zero skipped; Node test runner reported about 2.82 seconds. This is not an end-to-end development-loop benchmark. |
| `pnpm docs:check` | Initially failed on the existing modified Git README pair: list structure mismatch and stale English pairing hash. Passed on the final rerun for all eight packages after concurrent workspace changes. The investigation did not edit the pair. |
| `pnpm i18n:check` | Passed: six localized packages, two without UI strings. |
| Actual discovered plugin engine ranges against `testedDshVersion` | Git requires `>=0.1.6-alpha.2`; configured `0.1.5-rc.1` is incompatible. |
| `node scripts/workflow.mjs e2e worktrees-sidebar --dry-run` | Failed before side effects: unknown group; available groups are all, smoke, checkpoints. |
| In-memory probes of existing guard logic | README structural signatures remained equal with different fenced commands and link targets. Hardcoded English JSX passed the locale checker; a Chinese JSX control failed. No repository fixture was mutated. |

Do not read this report as “the branch is green.” The final documentation check passed, but the runtime-pin incompatibility remains unresolved and no full package/browser run was performed. The report also received an independent reader review; 71 source-link targets and line ranges were checked against the inspected repositories. Concurrent work means earlier test results are evidence for their run-time snapshot, not validation of every later edit.

## 2. What upstream actually does

| Area | Upstream arrangement | Useful adaptation here |
| --- | --- | --- |
| Local development | Scope the outgoing diff explicitly; run relevant checks once; exhaustive coverage and platform matrix belong to CI. | A scoped iteration ladder, with full checks retained as an explicit integration/release gate. |
| Unit tests | Vitest, source resolution, forked workers, Node by default, jsdom on browser specs. Coverage is a separate gate. | Node-first tests, a small common preset, measurable coverage, lifecycle tests. |
| E2E | Separate real-provider, keyless session replay, browser, expected-output, and built-artifact lanes. | Distinguish packed mount smoke, deterministic plugin behavior, and opt-in live AI behavior. |
| UI | Cordis-free primitives, theme tokens, pure presentation, controlled registration and shared module identity. | Prefer public primitives available in the supported npm SDK; keep domain UI local. |
| Reuse | Static platform libraries for shared identity; injected services/slots between feature plugins; private copies of ordinary implementation libraries. | Explicitly distinguish source reuse from runtime service sharing. |
| Agents | Layered instructions, focused procedural skills, decision notes, explicit check selection, test-reliability guidance. | Less repeated policy; smaller task context; evidence-bearing handoffs. |
| Build/CI | Large Host/Client generation graph, many gates and platform lanes, built-artifact consumers. | Borrow artifact correctness and dependency ordering, not the entire scheduler. |

Primary upstream evidence: [local check selection](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/skills/dsh-pre-push-checks/SKILL.md#L19-L77), [testing tiers](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/docs/testing.md#L7-L55), [client rules](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/AGENTS.md#L31-L83), and [build architecture](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/docs/development.md#L52-L98).

**Upstream is not internally perfect.** Its root instructions exempt local UI edits from Agent Notes, while its client checklist still says non-trivial changes need a note. Its extensive coverage gate has explicit exclusions. Its live-provider policy says inference is cheap because it is DeepSeek; that is not an appropriate cost assumption for this repository. Adopt principles after checking actual implementation and local constraints.

## 3. First fix: compatibility and truthful gates

### 3.1 Runtime pin is incompatible with an included plugin — P0

The [runtime pin](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow-config.json#L1-L3) is `0.1.5-rc.1`. [CI installs that pin](/Users/rokgrabnar/Projects/dsh-next-plugins/.github/workflows/ci.yml#L129-L146). The [Git manifest](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-git/package.json#L21-L24) requires `>=0.1.6-alpha.2`.

The runner [selects all bundles, including private ones](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow.mjs#L106-L123), and [rejects an unsatisfied engine before packaging](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow.mjs#L83-L93). A direct semver check over discovered manifests confirmed the mismatch. These configuration files were not dirty at inspection.

**Recommendation:** select and validate a runtime compatible with the intended smoke roster. Do not merely exclude the private Git plugin to make CI green if the lane promises to test the whole family. Add a cheap test comparing the actual discovered roster with the configured runtime pin. Mocked runner tests currently use simpler, older engine ranges and cannot catch this real inventory mismatch.

Then document a small support matrix: tested runtime, minimum supported runtime per plugin, SDK versions used to compile, and loader-module assumptions. A newer compile-time SDK is not proof of availability in an older host. Raising the full-family pin for Git must not silently discard existing support promises: retain a focused older-runtime lane for the applicable published-plugin roster, or deliberately revise those plugins' advertised support. This focused compatibility lane is distinct from falsely claiming an older host supports the entire family.

**Done when:** the inventory check passes, an incompatible fixture fails before packing, and real packed mount runs succeed for the new full-family target and any retained older supported roster. This report did not perform those browser runs.

### 3.2 Documentation and localization gates overpromise — P1

The [README policy](/Users/rokgrabnar/Projects/dsh-next-plugins/docs/i18n.md#L35-L44) requires identical fenced code and matching link targets. The [checker](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/verify-docs.mjs#L77-L128) intentionally ignores code contents, and its [comparison](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/verify-docs.mjs#L155-L164) contains no link-target comparison. An in-memory probe confirmed differing commands and links share the same signature. Hash recording is an acknowledgement, not semantic verification.

The [locale checker](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/i18n-check.mjs#L128-L138) rejects CJK outside dictionaries, not hardcoded English UI text. An untranslated English button passed a synthetic check. Upstream explicitly checks [product text ownership, including accessibility names and primitive labels](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/AGENTS.md#L111-L115).

**Recommendation:** align each rule with its actual checker. Add tested checks for fenced code/link parity and obvious JSX text plus user-visible attributes. Prefer an existing TS/JSX parser over a growing set of regexes; explicitly exempt data, code tokens, and internal diagnostics. Human review still owns translation meaning and strings built indirectly in helpers.

Do not create upstream's entire documentation gate system. Add negative-control tests to the two existing tools: valid localized usage passes; an English literal, mismatched command, wrong target, or placeholder mismatch fails for the intended reason.

### 3.3 Scope/release selection needs to reflect what ships — P1

[CI checks Changesets against `origin/main`](/Users/rokgrabnar/Projects/dsh-next-plugins/.github/workflows/ci.yml#L40-L47), while [contributor guidance targets `dev`](/Users/rokgrabnar/Projects/dsh-next-plugins/CONTRIBUTING.md#L9-L15). The [gate](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/verify-changeset.mjs#L71-L104) uses a direct diff, excludes all deletions and manifest changes, and only selects package-tree paths. Consequently, a release-affecting dependency/export change, a removed source file, or changed shared inlined code can escape the same selection used for ordinary source edits; test-only files can instead require a release entry.

**Recommendation:** preserve Changesets, but separate “changed files” from “changed shipped behavior.” Use the verified PR base and merge base; distinguish a deleted package from deletion inside a surviving package; inspect release-relevant manifest fields; map shared runtime inputs to consuming packages. Test base advancement and shared-source changes. Do not build a generic affected-task platform for eight plugins.

## 4. Unit testing: strengthen evidence, reduce setup

### Keep the existing strengths

The repository already tests real Git repositories, RPC response envelopes, client controllers, and workflow failures. The [runtime tests](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow-runtime.test.mjs) cover credential separation, scratch ownership, process termination, and descendants. The [pack tests](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow-pack.test.mjs) cover closure planning, tampering, missing declarations, unsafe paths, interrupted installation, and preserved unrelated state. These are meaningful tests, not ceremonial scaffolding.

### Add quantitative coverage without copying a 100% mandate

Upstream configures [per-file 100% statements, branches, functions, and lines](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/vitest.config.ts#L352-L363), with exclusions elsewhere in that configuration. Local [root commands](/Users/rokgrabnar/Projects/dsh-next-plugins/package.json#L10-L37) and sampled [Git](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-git/vitest.config.ts) and [Skills](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/vitest.config.ts) configs have no coverage gate despite the broad completeness mandate.

Start with a coverage report and a ratchet on changed modules. Use a high bar for pure decision logic, Git mutation safety, path validation, and credential handling. Review behavior coverage separately: an executed branch can still have no useful assertion. Do not turn every private export into a public commitment or spend time testing impossible states solely to achieve a number.

A short behavior map in the implementation plan is enough: public operation → success/error/cancellation behavior → owning tests → required packed/browser evidence. Avoid a manually maintained repository-wide spreadsheet of every function.

### Node-first configuration

Local mixed host/client packages default to jsdom, including real-Git suites. Upstream [selects jsdom per browser spec](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/AGENTS.md#L117-L124).

Introduce a small shared Vitest preset for stable defaults and the loader shim, leaving package-specific timeouts and paths explicit. Run pure/host tests in Node; opt browser tests into jsdom. First inventory tests that implicitly depend on DOM globals; migrate incrementally and measure the actual time reduction. Retain forks unless measurement and correctness support a different pool.

### Fix resource ownership before increasing parallelism

Two concrete examples illustrate why this matters:

- [Git fixture environment](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-git/tests/git-fixture.ts#L77-L96) copies the inherited environment and overwrites selected variables, but leaves Git routing variables such as `GIT_DIR`, `GIT_WORK_TREE`, and `GIT_INDEX_FILE`. Its [Git subprocesses](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-git/tests/git-fixture.ts#L155-L159) receive that environment. An inherited value could redirect fixture operations away from the intended temporary repository. The existing [E2E Git sanitizer](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow-runtime.mjs#L13-L16) already removes `GIT_*`; extract/reuse that policy in test support, then test poisoned environments against an owned sentinel repository. No redirection was executed during this audit.
- The current working-tree [RPC tests](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-git/tests/rpc.spec.ts#L138-L182) accumulate fixtures, but clean the collection inside only selected test bodies. Later tests create more fixtures without a suite-wide cleanup hook. Register disposal immediately in the factory through test-owned cleanup, rather than relying on later test ordering. This file is active user work, not a reviewed final implementation.

Upstream's useful model is [resource allocation, restoration, and disposal to completion](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/skills/dsh-ci-test-reliability/SKILL.md#L18-L100), demonstrated by [test-owned disposal](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/test-support/client-runtime/tests/assembly-test-client.client.spec.ts#L26-L30).

Add a small lifecycle test recipe: apply → observe registrations → dispose → observe absence → apply again. Include cancellation while async setup is pending where relevant. Mock the network/model/clock seam, not the whole behavior under test.

## 5. E2E: preserve packaged reality, separate responsibilities

### The current runner is an asset

The [runner](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow.mjs#L105-L195) packs once per invocation, creates a fresh home/workspace/runtime for each suite attempt, strips model credentials from non-live steps, and tears down owned processes. [Playwright](/Users/rokgrabnar/Projects/dsh-next-plugins/playwright.config.ts#L13-L24) uses one worker and no in-process retries. These choices protect real user profiles and avoid reusing polluted state.

Do not replace them with an upstream test harness that depends on source aliases or unpublished internal composition. Upstream owns its entire shell; your project is a consumer of published artifacts.

### Split family smoke from detailed behavior

The current [family test](/Users/rokgrabnar/Projects/dsh-next-plugins/tests/e2e/mount.e2e.ts#L836-L876) runs all plugin markers in one long interaction chain. A [later Skills mutation test](/Users/rokgrabnar/Projects/dsh-next-plugins/tests/e2e/mount.e2e.ts#L956-L992) explicitly expects the family marker to have left a session and installed skill.

This is suite isolation, not scenario independence. It makes a single scenario harder to rerun and one early failure can obscure unrelated evidence. The marker loop also skips a missing marker rather than rejecting absent coverage.

**Recommended lanes:**

1. **Family mount smoke:** all intended bundles present, every UI plugin has an explicit marker or justified exemption, each main surface opens, no crash markers. Keep it short and deterministic.
2. **Plugin behavior suites:** Skills install/remove, Git mutations/history, checkpoint rewind, OAuth state transitions. Each owns prerequisites; no reliance on a previous test's side effects.
3. **Opt-in live AI:** a small number of prompts with externally verified effects. Preserve protected secrets and explicit cost consent.

Start by moving one long scenario without changing the runner. Prove it passes alone and in another order. Only then consider suite-level parallelism with separate runtimes and bounded resources; raising Playwright workers today would be unsafe.

### Keyless is not offline

Your documentation correctly acknowledges remaining network traffic. Keep a small externally connected integration lane, but make ordinary behavior fixtures local and deterministic: local skill/provider repositories, controlled failure responses, and a scripted model endpoint when testing an AI-driven transition. A fake API key that produces an authentication failure is useful for an error test, not a successful-agent test.

Borrow upstream's [“verify the world, not the self-report” rule](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/docs/testing.md#L27-L41): inspect Git state, installed files, settings, or restored content rather than matching “done” in assistant text.

### Accessibility and visual evidence

Add small, owner-local ARIA/role assertions and a few deliberate screenshot comparisons for shared chrome, light/dark modes, and key modal states. Current screenshot capture is useful evidence but is not automatically a visual regression gate. Avoid full-shell golden images for every interaction: upstream shell changes would create noise outside your control.

Include keyboard focus, Escape, focus restoration, empty/error states, and locale switching. Keep visual comparisons deterministic through a pinned browser, theme, viewport, fonts, and controlled fixtures. Do not introduce Storybook unless isolated component development becomes frequent enough to justify another environment.

## 6. UI components and reusable code

### Reuse the public platform before recreating controls

Upstream has a [real primitives catalog](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/ui-primitives/README.md#L28-L87): Button, Input, Menu, Modal, RiskConfirmation, Tooltip, MarkdownText, DiffBlock, and more. The library is Cordis-free, token-styled, and accepts localized labels.

Make “check the supported SDK's primitives first” the start of UI work. Do not assume every export on upstream's latest branch exists in every supported DSH version. Import published public entry points only; upstream internal source paths are not a plugin SDK.

Keep domain-specific rendering local. The current Git work already uses a small [DiffBlock adapter](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-git/src/client/ui/FileDiff.tsx#L1-L35), which is the right direction. A read-only renderer is not necessarily a replacement for hunk selection, conflict editing, or staging controls. Prefer composition to a generic wrapper that simply renames all primitive props.

**Reuse still needs a behavior comparison:**

- Upstream's [Modal implementation](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/ui-primitives/src/Modal.tsx#L39-L83) provides portal, mask, Escape, and dialog semantics, but not focus trapping, initial focus, or focus restoration. Using the official primitive does not establish complete accessibility. Test the assembled behavior and add only the missing behavior at an appropriate seam.
- Skills owns a [225-line limited Markdown renderer](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/client/markdown.tsx#L1-L25). Evaluate deleting it in favor of the supported SDK renderer, but preserve privacy and link semantics: the [installed MarkdownText declaration](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/node_modules/@deepseek-ai/dsh-client-ui-primitives/lib/types/markdown/MarkdownText.d.ts#L17-L31) permits absolute HTTP(S) images. Replacing a link-only renderer could introduce remote-image requests. This is an evaluation candidate, not an automatically safe cleanup.
- Button dimensions are part of native consistency. Do not replace a settings-specific control with a primitive's default geometry solely to remove local CSS.

### Share small transport behavior, not every RPC envelope

The [Skills RPC client](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/client/index.ts#L41-L60) catches and rethrows nonempty errors, including JSON parsing errors. An HTML or malformed-JSON HTTP failure can therefore expose a parser error rather than the intended HTTP fallback. Test the error path before extracting shared transport behavior.

Fix and test the behavior first: JSON success, JSON server error, empty/HTML/malformed error body, network failure, and cancellation. Once the shared TypeScript build seam is solved, a small request/parse helper with injected fetch and error mapping can remove repetition. Keep Git failure/degraded results, OAuth error codes, and notifier keepalive/disposal semantics in their owners. A universal RPC client with a flag for every plugin would increase interface complexity.

### Share CSS only when multiple active panels need the same pattern

[Skills styling](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/src/client/card.module.css#L1-L15) currently owns its settings-page chrome. If another independent plugin adopts it, prefer a build-time authoring source over a globally mounted UI service. Keep plugin-specific rules separate.

Two build details need tests before this extraction:

- [Style-tag identity](/Users/rokgrabnar/Projects/dsh-next-plugins/shared/tsdown.client.ts#L330-L340) uses plugin id plus stylesheet basename. Two different directories containing the same basename can collide inside one bundle. Use a stable plugin id plus repository-relative source path.
- [CSS class hashing](/Users/rokgrabnar/Projects/dsh-next-plugins/shared/tsdown.client.ts#L314-L320) uses the source filename. A common source shared across independently released plugin versions can produce common selectors with different rules. Namespace the hashing input by owning plugin, or deliberately version a shared style asset. Verify mixed-version coexistence and unload cleanup.

**Done when:** one source edit changes both panels; each packed plugin works alone; loading/unloading either does not change the other; keyboard/light/dark checks remain correct.

### Distinguish three kinds of sharing

| Shared concern | Appropriate mechanism | Avoid |
| --- | --- | --- |
| Pure helpers, render-only chrome, small fixtures | Build-time source reuse with private bundled copies where appropriate | A runtime dependency merely to avoid a few copied lines |
| Live state or behavior owned by another plugin | Typed Cordis service and explicit lifecycle; slots for UI contributions | Importing another feature plugin's implementation values |
| React, Cordis, platform primitives and other identity-bearing modules | Host-supplied module-table identity supported by the tested runtime | Inlining duplicate singleton/stateful implementations |

Do not naively import shared TypeScript outside each package source root: the [declaration build](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-skills/tsconfig.build.json#L3-L13) uses `rootDir: src`. Choose a deliberate declaration/build strategy, or generation, and ensure published declarations do not reference unshipped repository paths. Shared inlined changes must also trigger rebuilds, tests, and release entries for consuming plugins.

The [purity gate](/Users/rokgrabnar/Projects/dsh-next-plugins/shared/tsdown.client.ts#L280-L295) checks `@deepseek-ai/` imports; its broad prose should not be mistaken for enforcement of every possible local cross-plugin relative or `@dsh-next` import. A small negative-control test should verify the actual forbidden local edges as well. Add focused preset tests before increasing its responsibilities: allowed/forbidden externals, same-basename CSS, deterministic output, watch dependencies, and independent unload. The [shared workspace currently only has a typecheck script](/Users/rokgrabnar/Projects/dsh-next-plugins/shared/package.json#L6-L9); the [test loader's unrestricted Node-resolution fallback](/Users/rokgrabnar/Projects/dsh-next-plugins/shared/vitest.setup.ts#L16-L34) is convenient for unit tests but does not establish production module-table or unload correctness.

### Do not migrate state architecture just to resemble upstream

The Git panel's [framework-free per-mount controller](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-git/src/client/controller.ts#L1-L14) is a useful seam: tests and UI exercise the same behavior without mounting the full shell. Keep that leverage.

Upstream now seeds [client-store and ui-dockkit](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/packages/client/web/src/seed.ts#L14-L38). Your [build preset](/Users/rokgrabnar/Projects/dsh-next-plugins/shared/tsdown.client.ts#L29-L71) has an older table and a runtime-store exemption. Current inspected local runtime references to that older entry were type-only; this is a candidate for removing unused build policy after checking artifacts, not evidence that every local store must migrate.

Likewise, investigate unused mobile/Host-phase preset options against all real call sites before removal. Keep the loader wrapper, external identity rules, CSS ownership, deterministic output, and source maps: those solve real distribution problems.

## 7. Development speed: remove repeated work first

### A. Focused local checks, exhaustive integration checks

The [current pre-push skill](/Users/rokgrabnar/Projects/dsh-next-plugins/.agents/skills/dsh-next-pre-push-checks/SKILL.md#L8-L33) requires all static and keyless browser suites before every push. Upstream explicitly [avoids rerunning a passing check merely for commit/push](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/skills/dsh-pre-push-checks/SKILL.md#L29-L50).

Proposed ladder:

| Changed surface | Local iteration evidence | Integration/CI evidence |
| --- | --- | --- |
| Pure plugin logic | Owning unit tests and package typecheck | Full static suite |
| UI behavior | Focused jsdom tests, locale checks, relevant browser scenario | Family mount plus behavior suites |
| CSS/shared presentation | Affected panels, keyboard and theme checks | Relevant visual comparisons and family mount |
| Manifest/build/SDK/shared runtime | Consumer build, pack inspection, affected mount | Full supported-roster verification |
| Docs/skills only | Owning documentation checks and command/link validation | Relevant policy checks, not model/browser work by default |

This requires an agreed policy update, not agents quietly skipping today's mandatory gate. Initially retain full CI and full local rehearsal for cross-cutting changes. Introduce affected selection only with conservative fallbacks for shared, configuration-driven, dynamically loaded, and unknown paths.

Start with existing `pnpm --filter` and file/name filters. Do not introduce Nx/Turborepo or copy upstream's gate scheduler before measurements show a need.

### B. Give bundling one owner

The [pack runner](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow-pack.mjs#L204-L218) explicitly builds before `pnpm pack`; package [build and prepare scripts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-git/package.json#L40-L45) both run tsdown. The root `ci` path also runs a full build during `check` before entering E2E packaging.

This repeats bundling by construction. It does not establish how much wall-clock time is wasted; measure before claiming a percentage.

Preserve tarball testing and lifecycle correctness. Design one packaging preparation path that emits declarations and bundles exactly once per artifact. Test clean-checkout packing, ordinary build, release packaging, cancellation, and dependency closure. Keep one representative package-manager lifecycle regression rather than disabling lifecycle scripts indiscriminately.

Only add artifact caching after this is correct. A safe cache key must cover source, shared inputs, manifests, lockfile, compiler/build configuration, relevant public environment, and toolchain. Avoid a bare “skip build” flag trusting stale output.

### C. Prototype a faster owned dev loop, not a replacement shell

Today [development always creates a fresh owned installation](/Users/rokgrabnar/Projects/dsh-next-plugins/CONTRIBUTING.md#L89-L96). That is excellent for acceptance verification but expensive for repeated visual edits.

Consider an explicitly separate iteration mode that watches only the selected plugin closure and updates artifacts in a developer-owned scratch runtime. First prove what the installed host actually serves and watches; do not assume a workspace watcher updates an installed tarball copy. Host changes may still need a controlled restart. Keep the current fresh-pack run as the acceptance gate.

Upstream's [watcher](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/scripts/dev-web.ts#L1-L25) exists to rebuild artifacts the host serves; it is not a standalone Vite development app. Do not copy its complete shell pipeline, modify the installed DSH checkout, or start another server and claim the existing GUI updated.

### D. Measure the loop people actually use

Collect build, pack, install, boot/readiness, browser, and teardown durations separately; record cold and warm cases. Track median time to a verified UI edit and flaky reruns over several ordinary changes. Prioritize the largest repeated phase. Cross-platform unit/fixture checks are worthwhile for Git and filesystem plugins, but a full browser matrix should follow declared support and demonstrated risk—not upstream's scale.

## 8. Agent workflows: less instruction drift, better task evidence

### Make instructions a map, not repeated procedures

Keep a concise root [AGENTS.md](/Users/rokgrabnar/Projects/dsh-next-plugins/AGENTS.md): SDK-only consumption, profile ownership, lifecycle/disposal, client identity, locale ownership, release boundaries, and links to focused procedures. Keep command semantics in root scripts, contributor instructions as the human entry point, and skills as task-specific procedures.

Concrete drift to fix together:

- The [root guide](/Users/rokgrabnar/Projects/dsh-next-plugins/AGENTS.md#L95-L100) still describes a manual profile flow rather than the current owned runtime.
- [Contributor commands](/Users/rokgrabnar/Projects/dsh-next-plugins/CONTRIBUTING.md#L56-L66) and [testing guidance](/Users/rokgrabnar/Projects/dsh-next-plugins/.agents/skills/dsh-next-local-testing/SKILL.md#L28-L37) name the nonexistent worktrees-sidebar suite. The dry-run failure was reproduced.
- The [contributor guide](/Users/rokgrabnar/Projects/dsh-next-plugins/CONTRIBUTING.md#L109-L112) references a capture command absent from the root script inventory.
- [Commit guidance](/Users/rokgrabnar/Projects/dsh-next-plugins/AGENTS.md#L114-L120) suggests feature, tests, and docs/process as three commits while also requiring each commit to stand alone. Prefer behavior + its regression tests + required docs together; separate independent process changes or preparatory refactors.
- The [structure guide](/Users/rokgrabnar/Projects/dsh-next-plugins/docs/package-structure.md#L43-L49) prohibits a fourth source zone, then gives a top-level feature directory as its example. Make examples agree with the rule.

Add a small tested command inventory/help contract, not a command parser for every Markdown code block. A broken example wastes both human time and agent turns.

### Keep the existing focused skills; add only missing judgment

Seven local skills are a reasonable number. Improve their accuracy and remove duplicate full-gate recipes before adding more. The strongest missing content is a short resource/test-reliability section: atomic scratch allocation, sanitized environments, immediate cleanup registration, readiness signals instead of sleeps, disposal completion, and negative controls for guards.

Upstream's [skills](https://github.com/deepseek-ai/deepseek-harness/tree/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/skills) generally separate check selection, test reliability, review, and simplification. Its manual-only metadata prevents expensive extended translation from being selected for routine edits. Borrow that distinction if your agent runtime supports it; do not assume metadata enforcement across clients without testing discovery.

Do not load every skill for every task. Trigger the narrow procedure, then load references only when the touched concern requires them. If multiple coding clients are actively used, provide aliases/symlinks to the same instructions where supported rather than maintaining copied instruction trees.

### Reserve Agent Notes for durable rationale

Local [note policy](/Users/rokgrabnar/Projects/dsh-next-plugins/.agents/notes/README.md#L1-L31) asks for a note per non-trivial change. Upstream now explicitly [exempts mechanical and local UI edits](https://github.com/deepseek-ai/deepseek-harness/blob/ddefc45fbc7f8e46dd73185e68295696d1297887/.agents/notes/README.md#L44-L50).

Adopt the decision rule, not its elaborate bilingual archive machinery:

- A durable architecture/security/compatibility choice needs rationale, alternatives, consequences, and verification expectations.
- An ordinary UI adjustment or bug fix can be explained by code, tests, commit, and PR.
- Temporary check results belong in run artifacts or the handoff, not a new long-lived rule.
- Search and update the owning note before creating another; label superseded records clearly.

This reduces context and maintenance without deleting important rationale. Existing notes should be triaged deliberately, not bulk-pruned by age or size.

### A practical agent task protocol

For an ordinary feature/fix, use this compact sequence:

1. **Establish scope:** repository/branch, dirty files, affected plugin, supported runtime, user-visible goal, and non-goals.
2. **Choose the seam:** name the small interface and owning implementation; preserve the existing pattern unless a real second consumer warrants a new abstraction.
3. **Plan evidence before editing:** behavior tests, error/cancel/dispose paths, packed/browser evidence, docs and release implications.
4. **Implement one vertical change:** behavior and its tests together. No adjacent cleanup unless it enables the change.
5. **Verify and independently review:** trace the real entry path and inspect the final diff, not just the author's summary.
6. **Handoff precisely:** changed behavior, exact commands/results, screenshots if visual, untested surfaces, risks, and next decision.

For larger tasks, delegate only independent domains. Use disjoint files/worktrees for concurrent writes; designate one owner for shared presets, lockfiles, suite registries, and instruction policy. Worktrees isolate files but do not isolate ports, profiles, or external resources. The integration owner must validate the combined result. More agents are not automatically faster.

Suggested evidence card:

```text
Scope and dirty work preserved:
Behavior changed / explicitly unchanged:
Owning tests and their regression:
Runtime, artifact, and browser evidence:
Exact commands: pass / fail / not run:
Release/docs implications:
Remaining risks and required decision:
```

## 9. What not to copy, and what to simplify

### Keep

- Independent packages, Cordis/profile mounting, public npm SDKs.
- Changesets per plugin and private-package release exclusion.
- The shared build preset and loader test shim.
- Fresh scratch homes, secret separation, owned process teardown, packed-artifact smoke.
- Token-based CSS, locale dictionaries, real filesystem assertions, bilingual package READMEs.
- Thin mise aliases over root commands. The aliases are not the problem.

### Simplify selectively

- Repeated full local gates and duplicate bundling.
- Manually synchronized presentation CSS.
- Stale command examples and multiple verification recipes.
- Routine-change Agent Notes.
- Broad “every export exhaustively tested” wording where it encourages implementation-coupled tests rather than behavioral evidence.
- Two overlapping external-PR auto-close policies: [all external content restriction](/Users/rokgrabnar/Projects/dsh-next-plugins/.github/workflows/reject-non-content-pr.yml#L31-L75) already covers the class targeted by the [docs-title rule](/Users/rokgrabnar/Projects/dsh-next-plugins/.github/workflows/reject-docs-pr.yml#L24-L73). Preserve the intended contribution policy, but one authoritative decision path is easier to maintain and avoids duplicate responses.

### Do not import upstream's scale

Do not adopt its 298-manifest topology, Host reflection/build graph, complete gate scheduler, every-PR benchmark matrix, full transcript storage/replay system, frozen bilingual note triplets, or blanket 100% policy merely for consistency. Do not recreate platform stores, a general RPC framework, or a universal plugin UI layer where existing services and small local modules suffice.

Add a lightweight linter for correctness and promise/React issues before building more prose/style rules. Treat clone detection as an occasional diagnostic initially; identical snippets are not automatically a reason for a new abstraction.

## 10. Prioritized implementation roadmap

Effort is a rough engineering estimate, not measured throughput. P0 = blocked required path or fixture-containment risk; P1 = recurring correctness/development cost; P2 = optimization after baseline measurement.

| Order | Priority | Work item | Effort | Acceptance evidence |
| --- | --- | --- | --- | --- |
| 1 | P0 | Align tested DSH pin and actual plugin roster | Small | Actual-manifest compatibility test; incompatible control fails; packed mounts cover the full-family target and retained older supported rosters |
| 2 | P0 | Sanitize Git fixtures and register cleanup immediately | Small–medium | Poisoned-environment sentinel test; cleanup on assertion failure; no leaked owned temp roots |
| 3 | P1 | Repair stale commands and consolidate verification guidance | Small | Every named command/suite exists; one canonical check ladder; no contradictory commit example |
| 4 | P1 | Strengthen locale/README gates and release-impact selection | Medium | Negative controls reject English UI literals, mismatched code/links, and missing release entries for shipping changes |
| 5 | P1 | Make smoke short; separate one detailed behavior suite | Medium | Scenario passes alone/order-independent; marker coverage explicit; full family still mounts |
| 6 | P1 | Remove duplicate bundling with one packaging preparation owner | Medium | Clean artifact parity; declaration closure; measured phase counts/times; lifecycle tests preserved |
| 7 | P1 | Introduce focused local policy, coverage report, Node-first tests | Medium | Full CI remains intact; selected tests nonempty; coverage gaps visible; recorded before/after iteration time |
| 8 | P1 | Fix RPC fallback errors; extract settings chrome safely | Medium, separate changes | Non-JSON failure tests; independent/mixed-version mount; no CSS identity collision; visual/keyboard/locale evidence |
| 9 | P2 | Prototype owned watch/rebuild mode | Medium | Proven edited artifact reaches exact scratch URL; clean shutdown; no user-profile mutation; final packed acceptance retained |
| 10 | P2 | Add targeted compatibility, visual, and performance checks | Incremental | One proven regression per new gate; bounded runtime/noise; documented support matrix |

Suggested first delivery is three small changes: compatibility guard/pin, fixture ownership fixes, then instruction/command repair. Each should include its own tests and directly affected docs. Only after those land should speed and reuse changes begin.

### Success criteria for the overall effort

- A developer or agent knows the smallest credible check for a change without reconciling multiple instruction files.
- A documented command never fails because it no longer exists.
- A changed plugin can be iterated on without repeatedly rebuilding unrelated plugins.
- The final package still installs and behaves in a clean real DSH runtime.
- Tests cannot mutate an unintended repository through inherited Git state.
- Shared styling has one authoring source without shared-runtime coupling or version-skew leaks.
- Faster development is supported by phase timings, not assumed from fewer files or more parallel workers.

**Bottom line:** your project does not need to become a miniature DeepSeek Harness monorepo. It needs a smaller, more accurate development interface over the safety and packaging infrastructure it already has.
