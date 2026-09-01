---
name: dsh-next-code-review
description: Review dsh-next plugin changes for correctness, SDK contract compliance, and lifecycle safety. Use when asked to review or audit code in this repository.
---

# dsh-next code review

Review changes against these checks:

1. **SDK contract** — imports come only from official `@deepseek-ai/*`
   packages; no DSH source checkout is referenced.
2. **Bundle purity** — no cross-plugin value imports in client code; the
   `shared/tsdown.client.ts` purity gate must stay green.
3. **Lifecycle safety** — every side effect (tool registration, route, timer,
   listener, slot) is reversible via `ctx.effect` or an official disposer.
4. **Config & schema** — settings namespaces are schema-validated and secret
   fields are redacted.
5. **Tests & coverage completeness** — new logic has a vitest suite, AND the
   suite covers every exported behavior with its edge/error branches (pure
   `core/` logic, the Host RPC response shape via a contract test, and any
   client wiring under jsdom). UI plugins must register a per-plugin DOM marker
   in `tests/e2e/mount.e2e.ts`. Flag any exported function or public behavior
   with no test. See `docs/plugins.md` → "The completeness contract".
6. **Non-regression** — the change must keep every existing test green. Call
   out whether the change could affect other packages or shared code, and
   require `pnpm typecheck && pnpm test && pnpm build` plus the mount smoke
   (`bash scripts/e2e-mount.sh`) as evidence.
7. **README pairing** — every package ships the `docs/i18n.md` triplet
   (`README.md`, `README.zh.md`, `README.i18n.yaml`); a behavior change that
   touches one side of a pair must mirror into the other and end with
   `pnpm docs:write-pair <slug>` so `pnpm docs:check` stays green.
8. **UI translation** — user-facing browser strings come from the package's
   locale dictionaries (`docs/i18n.md`); new en keys carry their zh mirror in
   the same change, `pnpm i18n:check` is green, and no CJK text leaks into
   non-dictionary client files.
9. **Style** — English, no emoji, Conventional Commit subject.

Report findings with file paths and concrete fix suggestions.
