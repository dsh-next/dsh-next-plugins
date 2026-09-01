# cc-plugins: Chinese UI localization through the platform locale service

- date: 2026-09-01
- status: implemented
- scope: packages/dsh-next-cc-plugins

Chinese-language support for the panel, following the platform `locale`
service pattern. Evidence base before building: DSH's own UI packages
(dsh-client-ui-settings-plugins, dsh-client-ui-conversation), and a full
survey of an independent provider's plugin collection — 17 packages, every
one using the identical `ctx.locale.register(NS, { zh, en })` / `bind(NS)`
/ function-label pattern, zero counter-examples. The mechanism is also
structurally required for the Settings nav: the shell resolves section
labels through the slot `label` + `locale` contract, so plugin-local
translation cannot localize the nav entry at all.

Implementation:

- `src/client/dictionaries.ts`: namespace `cc-plugins`, `en` as the key
  source (English is the fallback locale and this repo's language), `zh`
  mirrored with `Record<MessageKey, string>` (TS-enforced parity), `{name}`
  placeholders with the platform's substitution semantics, plus
  `englishTranslate` as the no-service fallback.
- `src/client/index.ts`: dictionaries register through `ctx.effect` with a
  duplicate-registration guard (a repeat `register` throws; aggregate
  bundles can double-apply — defense observed in the third-party
  reference). The section label is a bind-at-call-time function label
  carrying `locale: NS`, merged into `LocaleNamespaceMap` via module
  augmentation so the typed slot contract accepts it. The locale service
  is consumed defensively (`ctx.get` shape check); without it the panel
  renders English unchanged.
- `src/client/CcPanel.tsx`: every user-facing string rides `t`; the
  exported formatters (`inventorySummary`, `unbridgedSummary`,
  `presenceLabel`, `formatLastSync`) take an optional trailing translator
  defaulting to English, so their standalone behavior is unchanged. The
  pass also fixed a latent "Global Global" duplication in the modal's
  global target label.
- Deliberate boundary: host strings (install/update notes, errors,
  `record.notes`) stay English — they persist on install records and ride
  diagnostics; the locale service is client-only. README/docs/notes stay
  English per AGENTS.md. The third-party bilingual-README convention
  (README.zh.md + pairing record) was surveyed and not adopted — it would
  require changing the repo's English-only rule.

Tests: a new client-apply suite (identity-bind double pattern from the
ecosystem: dictionary registration, namespaced function label, duplicate
apply survival, no-service English fallback), dictionary parity plus a
zh-carries-CJK guard, zh rendering of panel chrome/empty states/modal, and
all 335 package tests green with English text assertions unchanged (the en
values are byte-identical to the pre-localization strings). The mount e2e
gains an explicit English-label assertion under the default locale.

Live proof: preview screenshots of the panel under the zh locale
preference and back under en (see the change's verification record).
