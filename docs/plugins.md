# Plugin conventions

Each plugin in `packages/dsh-next-<slug>` is an independent Cordis bundle
mounted through `cordis.patch.yml` and DSH profiles.

**Plugins are written in TypeScript** (`src/index.ts` host half,
`src/client/index.ts` browser half), compiled to `lib/` by tsdown. The only
plain-JavaScript in a plugin is the *dynamic preview* body fed to
`cordis_define`/`cordis_run` — that transport takes a raw JS function body and
is a process-lifetime iteration aid, not the shipped package. Build tooling
(`scripts/*.mjs`) is JS by Node convention, not plugin code.

## Package anatomy

A package contains:

- `package.json` — `@dsh-next/dsh-next-<slug>` name, publishable `exports`,
  `dsh.bundle.patch`, `dsh.client` declaration, build/test/typecheck scripts.
- `cordis.patch.yml` — inserts the plugin row (id `dsh-next-<slug>`) into the
  profile roster.
- `src/index.ts` — host half (Cordis `apply`).
- `src/client/index.ts` — browser half (only when the plugin has UI).
- `src/client/css-modules.d.ts` — the `*.module.css` ambient declaration a
  client that imports a CSS Module needs.
- `tests/*.spec.ts` — vitest suites.
- `tsconfig*.json`, `tsdown.config.ts`, `vitest.config.ts` — build configs
  delegating to `shared/tsdown.client.ts`. The `types` field includes `node`
  (the host route handler imports `node:http`), and `tsdown.config.ts`
  externalizes `@deepseek-ai/*` host peers by default.

How `src/` is organized as a package grows past the skeleton (the three source
zones, subdirectories, test layout, package `AGENTS.md`, and conditional
tsconfig tiering) is governed by
[package-structure.md](package-structure.md).

## Testing

### The completeness contract

A plugin change is not "done" when the tests you added pass; it is done when
**every functionality is covered and nothing existing was broken**. Before
merging, prove both:

1. **Every exported behavior has a test.** Enumerate the module's exported
   functions/classes and map each public behavior (including its error and
   edge-case branches) to a test case. Pure logic (`core/`) is fully
   unit-testable; host/browser wiring gets its own targeted tests (see the
   per-zone guidance below).
2. **No existing functionality regressed.** Run the full gate —
   `pnpm typecheck && pnpm test && pnpm build` — plus `bash scripts/e2e-mount.sh`
   (which now also runs the per-plugin DOM markers).

### Unit tests

- **Unit tests** live in each package's `tests/` and run via vitest
  (`pnpm test`). They are fast and isolated.
- Cover pure `core/` logic exhaustively: config normalization, the decision
  model (every `reason` branch and each `eventKind`), schema defaults and
  unions, and synth internals (each waveform, envelopes, base64 padding).
- **Contract tests pin the RPC payload shape.** When a Host method returns an
  object the browser card consumes, assert the exact envelope shape (keys, and
  that raw config keys are NOT at the top level) and that a `setConfig`
  round-trip actually persists through the settings scope. This is the class of
  bug that produces HTTP 200 with no error yet renders nothing.
- **Browser client wiring is testable under jsdom.** Mock `Notification`/timer
  to test the drainer and presence reporter's event, timer, and dispose
  behavior.

### End-to-end mount smoke

The **end-to-end mount smoke** lives in the root `tests/e2e/mount.e2e.ts` and is
driven by `scripts/e2e-mount.sh` (`mise run e2e`). It packs each plugin, mounts
it into a real scratch DSH profile, and asserts the browser renders with no
crash markers. This is the only test that catches frozen-module-table
mismatches and `cordis.patch.yml` registration errors.

**Per-plugin DOM markers** in `tests/e2e/mount.e2e.ts` are the layer that
catches "mounts without crashing but renders nothing" — the crash-marker check
cannot see a silent payload-shape mismatch. When a plugin ships UI, register a
marker (keyed by the bare slug) that drives to the UI and asserts real behavior
(e.g. open the settings card and assert its body renders). Handle the initial
onboarding dialogs with `dismissOnboarding()` before driving the sidebar.

The lane provides two fixtures every marker may use:

- **Preseeded workspaces** — `scripts/e2e-mount.sh` registers two scratch
  workspaces through the reusable `scripts/e2e-seed-workspaces.sh` and
  exports their canonical paths as `DSH_E2E_WORKSPACE_A` / `_B`, so
  markers can drive workspace-scoped UI without machine-specific paths.
- **On-disk assertions** — the spec process receives `DSH_HOME` and
  `DSH_AGENTS_HOME`, so a marker can assert real filesystem effects of
  the flows it drives (installed skill copies, `cordis.patch.yml` rows).
  Poll (`expect.poll`) for paths a just-triggered mutation writes.

## Bundle patch (`cordis.patch.yml`)

A plugin's `cordis.patch.yml` declares what the bundle contributes to the
running Cordis tree. `package.json`'s `dsh.bundle.patch` field points at it and
is what marks the package as an installable bundle (without it, DSH treats the
package as a plain dependency and loads nothing).

An `insert` row has three fields:

```yaml
- insert:
    - id: dsh-next-<slug>                 # join key: stable, specific
      name: '@dsh-next/dsh-next-<slug>'   # module specifier (npm name once published)
      config: {}                          # optional: initial Config value (Schemastery)
```

- `id` — the join key a profile's own patch, `$DSH_HOME/cordis.patch.yml`, or a
  `--patch` overlay uses to target the row later. Pick something specific; a
  collision means whichever layer loads later wins outright.
- `name` — the module exporting `apply`. Use the npm package form for a
  published bundle, or an absolute path to the entry for local development.
- `config` — optional; omitted when the plugin has no Config schema. Defaults
  come from the schema; this overrides them.

Bundle patches apply in `dsh.profile.bundles` order, then the profile's own
`cordis.patch.yml`, then `$DSH_HOME/cordis.patch.yml`, then `--patch` overlays.
Overrides **replace the whole `config` object** (no deep merge). Inspect the
composed result with `dsh --profile <name> --dump-config` before booting.

See the [local-testing skill](../.agents/skills/dsh-next-local-testing/SKILL.md)
for the manual live-install loop.

## SDK contract

- Types resolve only from the official `@deepseek-ai/*` npm SDK packages
  declared in `devDependencies`, never from a DSH source checkout.
- The `dsh.engines.dsh` lower bound must not exceed the DSH version used to
  verify a release.
- Client bundles must go through `shared/tsdown.client.ts` (the build-time
  purity gate rejects cross-plugin value imports; collaborate through Cordis
  services instead).

## SDK type resolution

The `@deepseek-ai/*` SDK splits its types across subpath export points and
uses `declare module` augmentations that only load when their declaring package
is imported. A few non-obvious rules every package follows:

- **`ISessions` is `@deepseek-ai/dsh-client-runtime/client`**, not the package
  root (`.`) entry. The root entry re-exports the runtime service, while the
  client-face contracts (`ISessions`, `IWorkspaces`, `SessionId`) live behind
  the `./client` subpath.
- **Cordis events type-check only after a type-only import of the declaring
  package.** `agent/status` (`dsh-agent`), `subagent/end` (`dsh-subagent`),
  `approval/request` (`dsh-user-approval`), `tools/execute` (`dsh-tools`), and
  `goal/changed` (`dsh-goal`) each live behind a `declare module
  '@deepseek-ai/cordis'` merge. Put `import type {} from '<declaring-package>'`
  in the host file that calls `ctx.on(...)`, or the event name fails to
  type-check as `keyof Events`.
- **Slots are declared by one package; a registrant pulls the `SlotMap` merge
  with a type-only import of the declarer.** For example
  `settings.plugin.item` is declared by `@deepseek-ai/dsh-client-ui-settings-plugins`
  (`import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'`).
  It is a **keyed** slot: `slots.register({ name: 'settings.plugin.item',
  key: '<settings-namespace>' })` — keyed by the settings namespace, not list
  fields `id`/`order`/`label`.
- **Waterfall handlers preserve `next()`.** `approval/request` and
  `tools/execute` are waterfalls whose `next()` returns a typed promise
  (`Promise<ApprovalOutcome>` / `Promise<ToolExecutionResult>`). An observer
  in those waters must `return next()` and match that return type.
- **Host peers stay external.** Every `@deepseek-ai/*` import in the host half
  is a peer service provided by the DSH profile tree; the tsdown config keeps
  them external (`libExternal`) so schemastery / dsh-settings / etc. are never
  bundled into `lib/index.js`. The scaffold ships this as the default; narrow
  the regex only when a package legitimately bundles a peer.

## Scope and access

- Plugins publish to the `@dsh-next` scope and use the `@dsh-next/dsh-next-*`
  naming convention.
- Repository tokens stay in the user-level `~/.npmrc`; the project `.npmrc`
  holds only scope mappings.

## Toolchain

- The root `package.json` declares `packageManager` (`pnpm@11`) and
  `engines.node` (`>=22`); `mise.toml` pins the same versions for local
  development and `.mise/tasks/*` provide thin task aliases. The `package.json`
  `scripts` block remains the single source of truth.
