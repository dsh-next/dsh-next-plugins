# Testing and local plugin installation workflow review

- Date: 2026-09-09
- Status: review and proposal; not implemented
- Scope: E2E, environment handling, mise, packaging/install, and CI
- Verdict: retain the test layers and packed-consumer checks; request changes to safety, isolation, and gate completeness.

## Evidence and limits

This review combines direct inspection, two independent focused agent reviews, official documentation, and earlier test runs in this session. No implementation files, profiles, running GUI, or credentials were modified. This is a process audit, not proof that every exported plugin behavior has exhaustive coverage.

Earlier validation: 1,637 package tests across 134 files and 39 script tests passed. Typecheck, build, docs, and i18n passed. Runtime-deps failed on the already-deleted worktrees sweeper.ts. Combined E2E: seven passed, one failed, one skipped; all six detailed checkpoint tests and family smoke passed. Sidebar failed with two bindings instead of one, then passed alone in a fresh runtime. These positive results do not eliminate the false-positive guards identified below.

Environment probes found the API key absent from inherited commands but present in interactive login zsh. This proves startup-mode dependence, not a missing global key or exactly which startup file supplies it. No secret values were printed by these probes. No new live-model requests were made during this review.

Review probes: `mise tasks deps ci` confirmed sibling gates without sequencing edges. Running the actual workspace seeder with a quoted `workspace with spaces` directory failed at the first space; the owned temporary probe was cleaned up. Installed tools: mise 2026.1.9, pnpm 11.24.0, Node 22.23.2. New mise syntax must be verified against the supported version rather than assumed from newer online documentation.

## Preserve these strengths

- Fast pure-logic, host-contract, and browser-DOM tests.
- Packed tarballs installed through official DSH plugin commands, not checkout links that mask dependency skew.
- Real-browser assertions paired with disk assertions for restore/install/remove behavior.
- Separate DSH home and shared-agent roots in the main E2E runner.
- Shared build preset, official SDK imports, and documentation/localization gates.
- Thin mise aliases with package.json as the command source of truth.

## Prioritized findings

### 1. High: keyless mode can make real model calls

Evidence: `scripts/e2e-mount.sh:237-245` preserves inherited DEEPSEEK_API_KEY regardless of DSH_E2E_LIVE, and tests send messages even in keyless mode. `scripts/dev-plugin.sh:82-102` separately executes interactive zsh to discover a key. `tests/e2e/checkpoints-chat.e2e.ts:24,44-46` skips only on the live-mode flag, not credential availability.

Impact: simply making global credentials available everywhere could turn ordinary smoke into paid calls, change timing, and introduce agent writes alongside test-generated writes. Explicit live mode without a key instead falls back to fake auth and fails late.

Required: one explicit keyless/live policy. Deterministic tests must not receive real model credentials. Live tests opt in and fail at preflight on missing, empty, or known-placeholder keys. Never execute interactive dotfiles automatically in the runner. A fake key still contacts an external service: call that lane keyless, not offline, until model transport and marketplace traffic use local deterministic fixtures.

### 2. High: caller-owned scratch data can be overwritten and deleted

Evidence: `scripts/e2e-mount.sh:39-46,58-102,194-208` treats DSH_HOME_BASE as the disposable directory itself, seeds over existing files, and removes the entire root. Cleanup is installed after initial seeding.

Required: treat an override as a parent for a fresh owned child, validate canonical containment, register cleanup immediately, and delete only that child. Caller-owned base directories and sentinel files must survive success, failure, interruption, and concurrent runs. Never apply this seeding policy to an existing user profile.

### 3. High: dev is not a safe existing-profile installer

Evidence: `scripts/dev-plugin.sh:44-45,64-69,105-137` accepts arbitrary profile/home selections and deletes profile node_modules, lockfile, and fallback before installation. Input reaches filesystem paths before independent containment validation. Its scratch mode also sets DSH_HOME but not DSH_AGENTS_HOME, leaving real shared skills exposed.

Required: a separate install-only command may default to web, but must not reuse destructive clean-profile orchestration. Share build/pack only. Isolate both roots for dev/testing. Preserve unrelated dependencies, settings, bundles, sessions, and skills during selected-profile installation. Normal targeted lockfile updates by the official installer are legitimate; deleting the whole lockfile/dependency tree is not. Never seed, boot, kill, or restart the selected runtime.

### 4. High: serial execution does not isolate E2E state

Evidence: `tests/e2e/mount.e2e.ts:707-739` retains e2e-reset-retention and a CLI worktree. `tests/e2e/worktrees-sidebar.e2e.ts:57-58,92-93` only reinitializes Git, then assumes an empty global registry. `playwright.config.ts:13-17` serializes one externally booted server and enables CI retries against the same mutable server state.

Impact: this explains the observed combined-suite failure and isolated rerun success. Fresh browser contexts or retry workers do not reset server settings, Git history, installed skills, or worktree registries. Fixed-content commits and deleted fixture skills can also poison retries.

Required: fresh home and workspace fixtures per independently runnable scenario group and retry. Reuse immutable packages, not mutable application state. Eventually use test-scoped fixtures where they own complete state. Keep a separate family compatibility smoke. Scope assertions to test-owned objects. Do not just change the expected count to two, reorder files, or delete registry.json under a running server.

### 5. High: smoke has false-green paths

- `tests/e2e/mount.e2e.ts:64-65,1075-1077`: bareId already returns dsh-next-X; the crash regex adds the prefix again.
- `tests/e2e/mount.e2e.ts:1079-1092`: error arrays are asserted before marker interactions, never afterward.
- `tests/e2e/mount.e2e.ts:1035-1041`: missing Checkpoints tab silently skips the panel assertion.

Required: match the escaped actual id, assert errors after interactions, and require expected UI after creating/selecting a suitable session. Add named test steps. Negative tests must prove failure for a real-prefix crash strip, a late browser exception, a plugin console error, and a missing tab whose boot entry still exists. A green positive suite cannot prove these guards work.

### 6. Medium: full-gate definitions diverge and omit coverage

Evidence: `.mise/tasks/ci:3` and `.github/workflows/ci.yml:63-79` omit test:scripts. `.mise/tasks/e2e:3` calls shell directly; `scripts/e2e-mount.sh:263-270` selects only mount.e2e.ts by default. Detailed checkpoint/sidebar scenarios are not run by default CI. Mise schedules build, typecheck, and tests as sibling dependencies; worktrees build/typecheck both regenerate browser sources (`packages/dsh-next-worktrees/package.json:52,58`).

Required: one canonical ordered package-script gate, invoked by mise and CI. Include script tests and all deterministic E2E groups. Keep a clearly named static gate and explicit live lane. Sequence shared generated writes before consumers. Report selected/executed/skipped scenarios instead of describing smoke as all E2E.

### 7. Medium: hidden installs and incompatible runtime targets

Evidence: pnpm 11 defaults verifyDepsBeforeRun to install; normal commands attempted an unwanted non-interactive reinstall in this session. `mise.toml:9-11` floats pnpm by major while package.json pins 11.24.0. `scripts/e2e-mount.sh:29-35` can fetch unpinned DSH through npx. CI pins DSH 0.1.2-rc.1 (`.github/workflows/ci.yml:144-145`), below the OAuth plugin declared minimum 0.1.3-alpha.2 (`packages/dsh-next-oauth-providers/package.json:21-24`).

Required: explicit dependency setup, with verifyDepsBeforeRun:error and an actionable install instruction rather than permanent false or automatic purge. Reconcile the current installation separately. Pin/record the intended runtime once, validate selected-plugin compatibility, and fail preflight instead of silently downloading a different CLI. The declared mismatch is proven; a remote CI run was not reproduced here.

### 8. Medium: diagnostics and process lifetime lack a common owner

Evidence: `playwright.config.ts:17-22` records on first retry but local retries are zero. `scripts/e2e-mount.sh:194-208` deletes logs/home on failure by default; lines 255-261 print the full authenticated URL. `scripts/dev-plugin.sh:144-164` lacks child cleanup after timeout/opener failure. `scripts/skills-e2e-boot.sh:182-204` has fixed PID/URL files and no failed-start teardown.

Required: one run owner, early cleanup, explicit signals, bounded termination/reaping, and no unrelated-PID operations. Retain failure traces/screenshots, sanitized server logs, fixture snapshots, tool versions, and phase timings in unique run/retry paths. Print origin only, keep browser authentication private. Raw logs/traces may hold credentials: private permissions, bounded retention, and controlled uploads are necessary. Do not upload entire scratch homes. Local temporary-instance auth URLs are not the model API key, but still are credentials while valid.

### 9. Medium: common path and working-tree cases are outside tests

Evidence: `scripts/e2e-seed-workspaces.sh:30-41` flattens argv with $* then splits spaces; confirmed by the review probe. Lines 53-58 recreate corrupt existing storage, and 86-87 write non-atomically despite the preservation promise. `scripts/runtime-deps-check.mjs:170-181,200-205` reads tracked sources including deleted working-tree paths; its tests exercise pure checks, not CLI enumeration.

Required: lossless argv, fail closed on corrupt state, and direct storage writes only to owned stopped scratch runtimes. Test CLI behavior with temporary repositories, spaces, additions, and deletions. Runtime-deps enumeration should include relevant existing tracked/untracked source and exclude ignored/generated dependency trees; handle deleted paths without swallowing unrelated I/O errors. Do not restore someone else's deleted source to make validation pass.

### 10. Medium: duplicated boot recipes have already drifted

Evidence: `scripts/skills-e2e-boot.sh:55-70,149-180` seeds legacy installed data, chooses a default provider different from its fake-key provider, and mounts via link. The main runner documents and uses installations. `scripts/capture-worktrees-readme.sh` repeats profile/install/boot/readiness/cleanup. Dev has another credential/home policy.

Required: consolidate repeated lifecycle implementation; keep plugin fixture data separate. Migrate supported probes to the common runner and explicitly propose retirement of superseded scripts. Do not silently delete helpers or collapse intentional screenshot/dev behavior into a single complicated mode switch.

## Proposed command surface

These commands are proposed, not implemented. Verify argument forwarding against supported mise versions. Every task delegates to a root package script.

| Command | Contract |
| --- | --- |
| `mise run install` | Explicit checkout dependency setup |
| `mise run test` | All package and script tests; no model credentials |
| `mise run check` | Ordered static checks and build |
| `mise run e2e` | All deterministic scenario groups plus family smoke, isolated |
| `mise run e2e -- checkpoints` | Focused deterministic checkpoint group |
| `mise run e2e-live -- checkpoints` | Explicit real-model scenario, required credential preflight |
| `mise run ci` | Static gate plus all deterministic E2E |
| `mise run plugin-pack -- checkpoints` | Build selected plugin and create immutable tarball |
| `mise run plugin-install -- checkpoints` | Build/pack/install only, default profile web |
| `mise run plugin-install -- checkpoints --profile dev-checkpoints` | Same operation with explicit profile |
| `mise run dev -- checkpoints` | Inspectable isolated plugin instance; explicit live option |

Root equivalents should use unambiguous `pnpm run test:e2e`, `pnpm run test:live`, `pnpm run plugin:pack`, and `pnpm run plugin:install`. Suite selection determines its required plugin set, avoiding independent flags that silently omit prerequisites. Existing install remains dependency installation, not plugin installation.

## Global API-key contract

An interactive-shell export reaches its descendants, not an already-running GUI or service. Therefore .zshrc discovery is not a portable configuration interface.

1. Deterministic child runtimes never receive real model credentials, never load live-key files, and never execute shell startup. Use local model/marketplace fixtures for truly offline tests; a fake key alone is only keyless.
2. Explicit live mode uses inherited nonempty environment first, then an explicitly selected data-only env file or one approved user-level testing env-file location. Fill only missing allowlisted variables; never overwrite CI-injected values. Missing credentials fail before packing/install/boot. Presence is not proof of account validity; billable connectivity checks remain explicit.
3. For global convenience, configure mise or the live runner to read the same approved user-level source outside the checkout. No key values in committed mise.toml, no arbitrary dotfile search. Ignore any new local-config filenames before recommending them: current .gitignore ignores .env but not all .env.* or mise.local.toml files.
4. Only the live DSH child needs the key. Do not inject it into build, packing, frontend bootstrap, result manifests, or command arguments. Registry-auth handling is separate. Do not reuse a whole credential store when only one named variable is needed.
5. A doctor/preflight command prints mode, credential-present boolean, source category, tool compatibility, and target paths, never secrets. Mise redaction is defense in depth; current docs explicitly warn that `mise env --redacted` exports sensitive values rather than hiding them.
6. Interactive zsh is a deliberate interim escape hatch for today's setup, not the permanent runner implementation. Startup scripts execute arbitrary commands and vary by machine.

## Safe default-web installer contract

Default web is appropriate only for install-only. Automated testing must never default to an existing user profile.

- Validate manifest-backed slug/profile, option values, paths, containment, and symlink escapes before any mutation.
- Respect standard DSH home resolution, with an explicit override. Show resolved home/profile and package identity before installation; offer dry-run and deliberate confirmation for a real profile.
- Build once, pack into a unique immutable/content-addressed path, and record package name/version/hash. Same-version source changes must not alias a mutable tarball filename. Keep referenced artifacts available after install.
- Verify packed runtime exports, declarations, README/media content, and absence of credentials/local artifacts. Pack already runs prepare; most packages use tsdown-only prepare while worktrees repeats a full build. Optimize duplication only after lifecycle tests establish correctness.
- Use official DSH installation and verify exact composed identity. Capture composition output before checking it; avoid the existing grep -q/pipefail early-close hazard.
- Permit normal targeted manifest/lockfile changes, not dependency-tree purges. Handle stale link migration narrowly or fail with recovery instructions. Serialize profile operations; accurately report partial failure rather than claiming unproven atomic rollback.
- Never seed settings, reset skills, boot a replacement server, or restart the agent host. Installation does not prove an already-loaded GUI updated; report required restart/reload and verify the existing URL only as a separately authorized runtime step.

## Simplification and performance

Use one small workflow module for repeated argument validation, immutable build/pack, owned scratch allocation, schema-correct seeding, readiness, diagnostics, and teardown. Existing-profile install remains separate orchestration because ownership differs. This shared seam is justified by the current dev, smoke, skills-only, and screenshot callers; it is not a hypothetical framework.

Prefer Node standard-library filesystem/process handling for structured argv, JSON, paths, and supervision. Keep mise/shell wrappers thin. Reuse Playwright fixtures and official DSH commands; no new orchestration framework or secret-manager dependency is required for the first improvements.

Build/pack once per run, reuse immutable artifacts across fresh scenarios, use OS-assigned ports, and defer parallel execution until mutable state is isolated. Remove duplicate generated writes. Replace fixed sleeps/broad forced clicks with durable state where possible; use cross-platform shortcuts rather than Meta+A. Ordinary runs write per-test evidence, while README screenshot promotion is explicit.

## Required verification for implementation

Use fake pnpm/DSH/opener processes and temporary homes to test orchestration without live accounts:

- Missing/present/placeholder/whitespace keys crossed with keyless/live, precedence, redaction, and least-exposure child environments.
- Missing live prerequisites fail before build/install/server side effects; explicitly requested scenarios cannot silently skip.
- Paths with spaces, malformed flags, traversal/symlinks, non-root cwd, and lossless mise/pnpm argv forwarding.
- Caller-owned sentinels survive all outcomes; both scratch roots isolate; concurrent runs keep distinct artifacts and process records.
- Existing web settings/unrelated bundles survive successful and failed targeted installs; distinguish legitimate lockfile updates from purge.
- Build/pack errors, stale same-version artifacts, missing/incompatible runtime, and failed exact composition checks.
- Early child exit, readiness timeout, interrupted run, failed opener, and TERM-resistant child teardown.
- Missing tab, actual-prefix crash strip, late pageerror/console error, and empty selected-plugin coverage produce nonzero failure.
- Mount then sidebar, reverse order, each scenario alone, and intentional mid-test failure plus retry all preserve isolation.
- Failure artifacts survive scratch cleanup, remain private/redacted, and use unique paths.
- Canonical full gate selects script tests and every deterministic scenario; runtime-deps CLI handles added/deleted sources.

## Staged plan

1. Safety and honest failures: negative tests, scratch ownership, agent-root isolation, explicit credential modes, early live preflight, and smoke-guard fixes.
2. Reliable suites: per-scenario/per-retry state; canonical ordered gates with script tests and full deterministic E2E; working-tree enumeration fix.
3. Shared lifecycle: consolidate seeding/readiness/teardown, redacted artifacts, supported runtime pins, and explicit dependency setup.
4. Install usability: immutable pack and non-clean install-only default-web tasks with validation, dry-run, and composition verification.
5. Documentation: update CONTRIBUTING and testing/pre-push skills together; migrate or explicitly retire duplicate probes after equivalent coverage. Keep facts in owning documents.

Land focused changes rather than a tooling rewrite. Each safety fix includes its regression test. Keep unrelated plugin feature changes separate.

## Upstream references

- [Mise environments](https://mise.jdx.dev/environments/) and [source](https://raw.githubusercontent.com/jdx/mise/main/docs/environments/index.md): non-interactive env loading and secret-output limitations.
- [Mise configuration](https://mise.jdx.dev/configuration.html) and [source](https://raw.githubusercontent.com/jdx/mise/main/docs/configuration.md): local versus committed configuration.
- [Mise task configuration](https://mise.jdx.dev/tasks/task-configuration.html) and [source](https://raw.githubusercontent.com/jdx/mise/main/docs/tasks/task-configuration.md): depends permits parallel execution, not list order.
- [pnpm 11 build settings](https://pnpm.io/11.x/settings/build#verifydepsbeforerun): install/error dependency-check policies.
- [Playwright fixtures](https://playwright.dev/docs/test-fixtures): ownership of setup/teardown and browser-context isolation.

Validate new syntax against the supported toolchain before implementation.
