# Harden the plugin scaffold against SDK-type gotchas

- date: 2026-08-28
- status: implemented
- scope: scripts/plugin-template, scripts/dsh-plugin-new.mjs, packages/*

While rebuilding dsh-next-notifier in TypeScript, several SDK type-resolution
and build issues cost debugging time. These are now prevented by the scaffold
and documented, so future packages do not re-hit them.

Scaffold fixes (template + dsh-plugin-new.mjs copy list):

- `tests/plugin.spec.ts` was in the template but not in the copy list, so
  `pnpm plugin:new` produced an empty `tests/` dir and vitest failed. Added to
  the copy list.
- `src/client/css-modules.d.ts` was missing from the template; any client using
  a CSS Module fails to typecheck. Added.
- `tsconfig.json` `"types": []` was changed to `"types": ["node"]`, and
  `@types/node` was added to the template `devDependencies`, so the host half
  can import `node:http` (the webServer route contract) without "Cannot find
  name 'Buffer'".
- `tsdown.config.ts` now externalizes every `@deepseek-ai/*` host peer by
  default (regex `libExternal`), so schemastery / dsh-settings / etc. are never
  bundled into `lib/index.js` (bundling duplicates module identity and triples
  output size).

Backport:

- The same `types: ["node"]` + `@types/node` was applied to the 8 existing
  skeleton packages (cron, files, git, org, previews, slack, telegram,
  workflows) so every package matches the updated template exactly. The
  orphaned JS prototype dsh-next-assistant was left untouched.

Documented (not scaffold-able, in docs/plugins.md → SDK type resolution):

- `ISessions` lives at `@deepseek-ai/dsh-client-runtime/client`.
- Cordis events and slots only type-check after a type-only import of the
  package that declares them; `settings.plugin.item` is a keyed slot (key =
  settings namespace).

All gates verified green after the backport: typecheck (9 packages + shared),
test (notifier 22 + 8 skeletons), build, docs:check.
