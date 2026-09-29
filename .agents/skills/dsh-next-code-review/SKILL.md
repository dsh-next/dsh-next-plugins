---
name: dsh-next-code-review
description: Review dsh-next plugin changes for correctness, SDK contract compliance, and lifecycle safety. Use when asked to review or audit code in this repository.
---

# dsh-next code review

Review changes against these checks:

1. **SDK contract** — imports come only from official `@deepseek-ai/*`
   packages; no DSH source checkout is referenced.
2. **Bundle purity and UI ownership** — no cross-plugin value imports in
   client code; the `shared/tsdown.client.ts` purity gate must stay green.
   Browser views belong to feature directories, with the top-level panel
   coordinating rather than implementing every interaction. Feature modules
   should import translation types and failure labels from their owners, not
   a parent panel; share UI only when it removes actual duplication. See
   `docs/package-structure.md` → "Browser UI composition".
3. **Lifecycle safety** — host side effects (tool registration, route, timer,
   listener, slot) are reversible via `ctx.effect` or an official disposer.
   In React, hooks stay unconditional, render stays free of side effects
   (including registry refcounts and external ref publication), and committed
   subscriptions/timers/listeners clean up when their owner unmounts. Check
   disposed guards after awaited startup and versioned/aborted overlapping reads.
4. **Config & schema** — settings namespaces are schema-validated and secret
   fields are redacted.
5. **Tests & coverage completeness** — new logic has a vitest suite, AND the
   suite covers every exported behavior with its edge/error branches (pure
   `core/` logic, the Host RPC response shape via a contract test, and any
   client wiring under jsdom). UI plugins must register a per-plugin DOM marker
   in `tests/e2e/mount.e2e.ts`; markers must take workspace paths from the
   `DSH_E2E_WORKSPACE_A/B` env vars, never hardcoded machine paths, and prefer
   on-disk assertions (`DSH_HOME`/`DSH_AGENTS_HOME`) for install/mutation
   effects. For a UI-only refactor, verify DOM/ARIA/keyboard behavior,
   marker names, focus, and error recovery rather than changing expected
   output to fit the move. Include abandoned-render/Strict Mode cleanup,
   delayed RPC responses, clipboard rejection or a false acceptance result,
   and Enter on sibling buttons
   wherever those paths exist. Flag any exported function or public behavior
   with no test. See `docs/plugins.md` → "The completeness contract".
6. **Non-regression** — the change must keep every existing test green. Call
   out whether the change could affect other packages or shared code. Focused
   package tests and an owning named E2E suite (when available) give iteration
   evidence; `pnpm run ci` (static checks plus all keyless E2E suites) is
   required before merging. Report unrelated gate failures instead of
   weakening a marker or treating a focused pass as the full gate.
7. **README pairing** — every package ships the `docs/i18n.md` triplet
   (`README.md`, `README.zh.md`, `README.i18n.yaml`); a behavior change that
   touches one side of a pair must mirror into the other and end with
   `pnpm docs:write-pair <slug>` so `pnpm docs:check` stays green.
8. **UI translation** — user-facing browser strings come from the package's
   locale dictionaries (`docs/i18n.md`); new en keys carry their zh mirror in
   the same change, `pnpm i18n:check` is green, and no CJK text leaks into
   non-dictionary client files.
9. **Installed-plugin presentation** — verify the bundle follows
   [Plugin display metadata](../../../docs/plugins.md#plugin-display-metadata).
   Check readable localized copy, distinct artwork, resolvable exports, and
   tarball inclusion without renaming npm/Cordis identities. A valid source
   SVG or manifest alone is not runtime evidence: require the installed card
   to show the expected title/description and a successfully decoded image.
10. **Style** — English, no emoji, Conventional Commit subject.

Report findings with file paths and concrete fix suggestions.
