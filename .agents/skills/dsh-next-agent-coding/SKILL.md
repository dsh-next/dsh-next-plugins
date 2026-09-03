---
name: dsh-next-agent-coding
description: Implement and maintain dsh-next plugins. Use when the user asks to code, fix, build, or extend any `@dsh-next/dsh-next-*` package in this repository.
---

# dsh-next plugin development

Read `AGENTS.md` and `docs/plugins.md` first, then follow these steps.

1. Confirm which package (`packages/dsh-next-<slug>`) the work targets.
2. Never modify a DSH source checkout; import only from the official
   `@deepseek-ai/*` SDK packages.
3. Edit `src/index.ts` (host entry) and `src/client/index.ts` (browser entry).
   Keep both thin; place host-only logic in `src/host/`, browser logic in
   `src/client/`, and pure shared logic in `src/core/`. Follow the three-zone
   and subdirectory rules in `docs/package-structure.md`. Collaboration
   between halves goes through Cordis services, never cross-plugin value
   imports.
4. Resolve SDK types from the right entry points (see `docs/plugins.md` →
   "SDK type resolution"). In short: `ISessions` is `@deepseek-ai/dsh-client-runtime/client`;
   Cordis events and slots only type-check after a type-only import of the
   package that declares them (`import type {} from '...'`); host peer packages
   stay in `tsdown.config.ts` `libExternal`.
5. Add a vitest suite under `tests/` for any new logic. **Cover every exported
   behavior and its edge/error branches** — pure `core/` logic exhaustively,
   the Host RPC response shape (contract test: assertion on the envelope AND
   that a `setConfig` round-trip persists through the settings scope), and the
   browser client wiring (mock `Notification`/timers under jsdom). See
   `docs/plugins.md` → "The completeness contract".
6. If the plugin ships browser UI, register a per-plugin DOM marker in
   `tests/e2e/mount.e2e.ts` (keyed by the bare slug) that drives into the UI and
   asserts real behavior — the crash-marker layer cannot catch a silent
   payload-shape mismatch. Use `dismissOnboarding()` first for a fresh scratch
   home. Workspace-scoped UI drives the preseeded workspaces via the
   `DSH_E2E_WORKSPACE_A/B` env vars — never hardcoded paths (see
   `dsh-next-local-testing`). Every user-facing string goes through the
   package's locale dictionaries (`src/client/dictionaries/en.ts` + `zh.ts`,
   wired per `docs/i18n.md`) — add the en key and the zh translation in the
   same change.
7. Keep the package's bilingual README pair consistent (`docs/i18n.md`): a
   change that alters behavior described in `README.md` must mirror the edit
   into `README.zh.md` in the same change and re-record the pairing hashes
   with `pnpm docs:write-pair <slug>`. New packages are scaffolded with the
   full triplet by `pnpm plugin:new`.
8. Run the full gate before merging: `pnpm typecheck && pnpm test && pnpm build`
   then `pnpm i18n:check` and `bash scripts/e2e-mount.sh`. Confirm **every**
   existing test still passes and the mount smoke (with the DOM markers) is green.
9. If the change touches a publishable plugin's source, record a change file:
   run `pnpm changeset`, pick the packaged packages and bump kinds, and write
   the entry following the CHANGELOG best practices in the `dsh-next-release`
   skill and `.changeset/README.md`. A source change without a change file
   fails CI. Skip this for `"private": true` packages.
10. Record the change as an Agent Note under `.agents/notes/`.
11. Commit **logically**, one concern per commit (Conventional Commits, no
    emoji). Split a change into multiple commits when it crosses distinct
    concerns — e.g. the feature, its tests, and a docs/process update are three
    commits — and group files that must land together into one commit. Never
    bundle unrelated fixes into a "misc" commit, and never leave a commit whose
    message does not match its contents; each commit must leave the repo
    buildable and tests green. See `AGENTS.md` → "Branches, Commits, and PRs".
