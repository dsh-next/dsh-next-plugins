# Resolve the native Models row path for subscription providers

- date: 2026-09-24
- status: implemented
- scope: packages/dsh-next-oauth-providers

## Symptom

Opening **Edit** on a subscription row on the native Models page rendered a red
`openai-codex-oauth: unresolvable settings path` (the row's own alias) under the
row card and nothing else: no fields, no Apply, and no Cancel. The only visible
Cancel belonged to this plugin's own card in the row, and it cannot dismiss the
native card, so the row looked stuck.

## Root cause

`providers` was declared as
`Schema.union([Schema.dict(profile), Schema.array(legacyRow)])`. The native
Models page resolves a declared row's settings path against the **serialized
entry schema** — `SettingsSchemaService.nodeAtPath` in
`@deepseek-ai/dsh-client-ui-settings` — and that walk descends object `dict`
nodes and dict/array `inner` nodes only:

```js
if (node.type === 'object') node = node.dict?.[key]
else if (node.type === 'dict' || node.type === 'array') node = node.inner
else return undefined
```

A `union` node ends the walk, so `['providers', <nativeId>]` resolved to
`undefined`, and the native editor returns early with the error paragraph
instead of its card and footer. The union existed only to keep the pre-0.1.7
`settings.yaml` row array loadable.

## Fix

- [schema.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/core/schema.ts)
  declares the platform's own shape for a configurable-provider directory:
  `Schema.dict(profileSchema)` (compare `llm-pi-ai`'s `z.dict(profile)`), which
  the native walk resolves per native id.
- `loose(true)` is the bridge for the one shape a dict cannot carry: a rejected
  value resolves to the field's empty default instead of throwing, so a stored
  pre-0.1.7 array no longer fails the whole entry (which would leave the profile
  patch permanently unloadable).
- [index.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/index.ts)
  `readProviders()` falls back to the raw user section when the resolved section
  is empty, which is what keeps `hydrate()` able to rewrite a legacy array into
  the dict shape once instead of wiping it. Only a non-empty raw section wins
  over an empty resolved one, so a section the user cleared stays cleared.

Recorded trade-off: a malformed `providers` value is no longer a hard entry
failure. It resolves to the empty default, the plugin reads the raw section,
`normalizeConfig` sanitizes it, and `hydrate()` writes the normalized dict back
— self-healing rather than a patch that never loads.

## What the row's Edit card shows now

The native card for a subscription row is the platform's unknown-layout card:
`Other fields live in cordis.patch.yml; edit that section directly.
(dsh-next-oauth-providers)`, with Apply disabled and a **working** Cancel. That
is the platform's own treatment for a namespace it has no curated layout for;
this plugin's card inside the row (sign-in state, catalog editor, Apply) stays
the editing surface.

The seat card's own Cancel discards the catalog draft and closes the
Customized settings fold; it does not close the card, because the seat's editor
is always open on a configured row.

## Evidence

- `tests/schema-path.spec.ts` pins the platform traversal rule against the
  serialized schema: red before the fix (`kimi-coding: expected undefined to be
  defined`), green after.
- `tests/e2e/oauth-helpers.ts` now asserts the symptom directly: after the
  row's **Edit**, no `unresolvable settings path`, the native card is visible,
  and its Cancel closes it. Run against the pre-fix schema the suite fails at
  `oauth-helpers.ts:76`; against the fix it passes.
- `tests/host-apply.spec.ts` covers the config reads (raw legacy array wins over
  an empty resolved section; the resolved section wins once it holds a dict; a
  cleared section is not resurrected), and `tests/host-service.spec.ts` covers
  the array-to-dict rewrite through `hydrate()`.
- Dev runtime: with the row's Edit card open, `unresolvable settings path`
  appears 0 times, the native card renders its hint, and its Cancel closes it.
- `mise run e2e -- oauth-providers` and `mise run e2e -- smoke` pass.
