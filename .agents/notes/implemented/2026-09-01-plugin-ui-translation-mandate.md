# Plugin UI translation mandate with i18n:check gate

- date: 2026-09-01
- status: implemented
- scope: packages/dsh-next-cc-plugins, packages/dsh-next-skills,
  packages/dsh-next-notifier, scripts/i18n-check.mjs,
  scripts/plugin-template, docs/i18n.md, AGENTS.md, .agents/skills,
  .github/workflows/ci.yml, .mise/tasks

## What

Every user-facing string in a plugin's browser half must now come from the
package's locale dictionaries, translated through the platform `locale`
service. All three UI plugins are bilingual:

- `dsh-next-cc-plugins` - 100 keys, refactored from a single inline
  dictionaries file to the per-locale split
  (`src/client/dictionaries/en.ts` key source + `zh.ts` typed mirror +
  `helpers.ts` fallbacks + `dictionaries.ts` barrel);
- `dsh-next-skills` - 63 keys extracted from SkillsPanel (tabs
  已安装/搜索/提供方, actions, confirms, scopes), section label now a
  function label carrying `locale: NS`;
- `dsh-next-notifier` - 48 keys extracted from the settings card (toggles,
  volume, triggers, presence).

`pnpm i18n:check` (`scripts/i18n-check.mjs`) enforces the contract:
a package whose client half ships `.tsx` must declare dictionaries,
zh mirrors the en key set exactly, every `{placeholder}` set matches between
locales, and no CJK text appears outside dictionary files (per-line
`// i18n-allow: <reason>` exemption). Wired into `package.json`
(`i18n:check`/`i18n:list`), CI, `mise run ci`, and the pre-merge line in
`AGENTS.md`.

## Key decisions

- **No new runtime package.** The question "should we build reusable
  translation logic in a shared package" was answered by reading the SDK
  surface: `@deepseek-ai/dsh-client-locale` already provides typed
  registration (both locales in one compile-checked call, bilingual balance
  enforced, duplicate registration throws), the lookup chain (namespace ->
  en -> shared `common` vocabulary -> key, fail loud), `{name}`
  interpolation, `bind` returning a stable typed translator, the durable
  preference, the Language row, and live re-render on switch. Building our
  own layer would reinvent it. Our reusable assets are conventions and
  tooling: the per-locale file layout, the scaffold skeleton, and the gate.
- **English is the key source** (mirroring the repo's language and the
  platform's `FALLBACK_LOCALE`), opposite of first-party DSH's
  Chinese-first convention - the invariant (one key source, others
  complete) is what matters; the platform's typed `register` checks both.
- **The gate covers what the compiler cannot**: the mandate itself
  (.tsx implies dictionaries), cross-locale placeholder parity, and CJK
  leakage into non-dictionary client files.
- **Host-side strings stay English** (install notes, host-generated toasts
  and errors, host-provided data such as sound names): they persist on
  records or are quoted in diagnostics, per `docs/i18n.md`.
- **Scaffold ships the skeleton**: `plugin:new` copies an empty
  en/zh dictionary pair + barrel, so a new plugin is gate-compliant from the
  first commit and the pattern is visible before any UI exists.
- **Dependency normalization**: `@deepseek-ai/dsh-client-locale` pinned
  `0.1.1-rc.2` as a devDependency of all three UI packages (notifier had
  used a structural interface, skills resolved the type from an ambient
  hoisted copy); all three now use the same type-only `/client` import and
  `ctx.get('locale')` wiring.
- **README terminology kept in sync**: skills' `README.zh.md` references to
  the now-localized tabs were updated (已安装/更新/全部刷新) and the README
  pairing record re-recorded.

## Structure

- `scripts/i18n-check.mjs` - the gate (`checkPackage`: mandate, `parseDictionary`
  key/placeholder extraction, CJK scan; `--list` report mode).
- `packages/*/src/client/dictionaries/{en,zh,helpers}.ts` + `dictionaries.ts`
  barrel - the standard layout; cc-plugins is the reference implementation.
- `scripts/plugin-template/src/client/dictionaries*` - scaffold skeleton.
- `docs/i18n.md` - "Plugin UI strings" section: layout, wiring, platform
  capabilities, gate scope, English-side boundaries.
- `.agents/skills/dsh-next-agent-coding` (step 6 + gate list),
  `.agents/skills/dsh-next-code-review` (check 8) - process enforcement.
- `.github/workflows/ci.yml`, `.mise/tasks/{ci,i18n-check}` - gate wiring.

## Validation

- Package suites: cc-plugins 335/335 (refactor is behavior-preserving,
  including the identity-bind double, duplicate-apply survival, and
  no-service English fallback), skills 196/196 and notifier 71/71 with
  zero test edits (en values byte-identical to the pre-change strings).
- Repo gates: `pnpm typecheck && pnpm test && pnpm build`, `pnpm i18n:check`
  (3 localized packages, 8 without UI strings), `pnpm docs:check`
  (11 bilingual README pairs), `bash scripts/e2e-mount.sh` (real-mount smoke
  green with the localized UIs).
- Live proof (scratch DSH home, seeded `locale` experiments): the zh shell
  renders the Skills section as 技能 with tabs 已安装/搜索/提供方, the
  seeded skill with 全局 badge and 停用/移除/更新 actions, and the notifier
  card with 启用通知/音量/测试浏览器通知; no English UI labels leak in zh
  mode. Screenshots: /tmp/zh-skills.png, /tmp/zh-notifier.png. Seeding
  `locale.preference: zh` in settings.yaml before boot did NOT adopt zh in
  a fresh browser (consistent with the earlier real-home observation); the
  Language row switch works and is the reliable path.
