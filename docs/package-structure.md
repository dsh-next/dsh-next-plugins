# Package structure conventions

Every plugin lives in `packages/dsh-next-<slug>`. The fixed skeleton is
scaffolded by `pnpm plugin:new <slug>` and is documented in
[plugins.md](plugins.md#package-anatomy). This page governs how a package's
`src/` is organized as it grows past the skeleton — where a new file goes,
how subdirectories and tests are laid out, and when to tier the TypeScript
programs.

These conventions are modeled on the dsh-web reference repository. Keep each
rule in this document; do not duplicate it into individual package READMEs or
AGENTS.md files.

## Three source zones

Every source file under `src/` belongs to exactly one of three zones. A new
file that does not fit one zone is a sign the package boundary needs thought,
not an invitation to add a fourth zone.

| Zone | Runtime | Holds |
| --- | --- | --- |
| `src/index.ts` | host process | the host-half Cordis `apply` entry |
| `src/host/` | host process | host-only services, runners, HTTP, tools |
| `src/client/` | browser (Web GUI) | React views, slots, hooks, CSS Modules, locales |
| `src/core/` | both (compiled by both sides) | pure shared logic — controllers, use-cases, stores, types |

- `src/index.ts` stays a **thin** `apply`: it wires `src/host/*` and
  `src/core/*`, and registers host-side services and tools. It does not grow
  feature logic.
- `src/client/index.ts` is the analogous thin browser entry: it registers
  slots and views and delegates to `src/client/*` and `src/core/*`.
- `src/core/` must be free of host or browser identity — no `ctx.sessions`
  store types, no DOM, no `window`, no process-specific imports. It is the
  only zone both halves may import.

The two halves collaborate through Cordis services (`ctx.slots`,
`ctx.sessions`, `ctx.workspaces`) or the loopback HTTP pattern, never through
cross-plugin value imports. The build-time purity gate in
`shared/tsdown.client.ts` enforces this for the browser half.

## Subdirectory conventions

- **`src/core/`** groups logic by domain. One file per use-case is a useful
  default: `src/core/use-cases/task-create.ts`, `task-update.ts`,
  `task-archive.ts`, alongside `store.ts`, `controller.ts`, `schedule.ts`.
- **`src/host/`** groups services by concern: `git-service.ts`,
  `git-runner.ts`, `routes.ts`, `http.ts`, `agent-tool.ts`. A large feature
  gets its own directory (for example `src/perf/` holding its `service.ts`
  and `migration-*.ts`) rather than a flat pile of files.
- **`src/client/`** groups by feature, not by file kind. React components live
  in a feature directory (`src/client/chips/`, `src/client/graph/`,
  `src/client/worktrees/`). Flat helper modules keep feature-neutral names:
  `api.ts`, `locales.ts`, `telemetry.ts`.
- **CSS Modules sit beside their component** — `TaskBoard.tsx` next to
  `board.module.css` — not in a separate `styles/` directory. A shared sheet
  stays file-adjacent to its primary component.

## Browser UI composition

- Give each feature its own view, controls, and dialogs under its feature
  directory. A page or panel at the top of `src/client/` coordinates features
  and their shared flows; it should not also implement every row, form, and
  modal. Split an action-switching view when the new owners can drop unrelated
  state and reads; keep one cohesive controller rather than extracting thin
  pass-through modules merely to meet a line-count target. Registration
  groups and feature-owned CSS belong beside their owners; retain shared
  panel chrome only where multiple views use it.
- Keep reusable browser contracts (translation types, failure labels, resource
  addresses) in their owning modules. A feature should not import a parent
  panel just to use a translator or error mapping. Share a UI primitive when
  concrete views repeat its behavior; avoid generic pass-through wrappers,
  speculative context, and prop bags that merely move complexity around.
- Follow React's ownership and lifecycle rules: call hooks unconditionally,
  keep render free of side effects, and subscribe or attach timers and
  listeners in effects with cleanup. For external stores, expose stable
  snapshots and subscribe through `useSyncExternalStore`. Never acquire a
  process-wide store, increment a refcount, or publish actions to an external
  ref during render (including a `useMemo` initializer); acquire/publish on
  commit and release on cleanup so abandoned renders and Strict Mode replay
  cannot leave stale ownership. Guard asynchronous setup after disposal and
  version or abort overlapping reads so older responses cannot replace newer
  data or errors. Scope keyboard shortcuts to their intended focused control.
  Read framework hooks only where React permits; if the shell can throw during
  a transient render, contain that failure around the affected view rather
  than retiring the whole plugin. Understand and test an existing lifecycle
  workaround before changing it; do not copy an impure pattern into new code.
- During a behavior-preserving reorganization, inventory exports, callers,
  error paths, and lifecycle ordering first. Keep the rendered DOM, ARIA and
  keyboard behavior, locale keys, CSS, and test/E2E markers stable. Move one
  concern at a time and rerun its focused tests; then run the full checks and
  the owning plugin's real-mount suite from
  [plugins.md](plugins.md#the-completeness-contract). Separate any actual
  behavior or visual redesign from the refactor.

## Tests mirror the source

Unit tests live in `tests/` and are named for the module under test, mirroring
the source tree: `src/host/git-service.ts` -> `tests/git-service.spec.ts`,
`src/client/boards/TaskBoard.tsx` -> `tests/TaskBoard.spec.tsx`,
`src/core/store.ts` -> `tests/store.spec.ts`. A test for one zone stays a
`.spec.ts` / `.spec.tsx` that targets one module; it does not test across
zones except through the thin `apply` entry.

See [plugins.md](plugins.md#testing) for the unit-vs-mount-smoke split.

## Package-level AGENTS.md

Write a package's own `AGENTS.md` only when the package has rules that do not
belong in the shared documents: a cross-directory rule, a complex build chain,
or a security model. It documents only that package's specifics and never
repeats `AGENTS.md`, `docs/plugins.md`, or this page. Keep it concise; the
exemplars are short two-section files (a "rules" list and a "pre-submit
checks" block).

## TypeScript program tiering (conditional)

By default a package has a single TypeScript program: `tsconfig.json`
(typecheck everything) plus `tsconfig.build.json` (emit declarations). That is
correct for the skeleton and for most small plugins.

Tier the programs — split into a solution file plus one program per side —
only when a plugin grows a real host/client type conflict. The concrete
trigger is a **module augmentation that differs by half**: when the host half
declares `sessions` as one type and the browser half declares it as another
(for example `SessionStore` vs `ISessions`), both merges land in one global
namespace under a single program and typecheck fails. At that point:

- `tsconfig.json` becomes a solution file (`"files": []`, `references` the
  per-half programs).
- `tsconfig.host.json` covers `src/index.ts` + `src/host/`.
- `tsconfig.client.json` covers `src/client/` + `src/core/`.
- `tsconfig.vitest.json` covers `tests/` + the zones each test imports.

`src/core/` is included in both half programs, never in its own. Do not tier
speculatively: the extra `tsconfig.*.json` files are noise until a real
half-specific merge forces the split.
