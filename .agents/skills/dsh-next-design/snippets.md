# dsh-next design — scaffolds

Copy-paste starting points for the standard plugin surfaces. Values are the
shell's own (verified against `@deepseek-ai/dsh-client-ui-settings-plugins` in
the installed checkout); prefer copying the live shell CSS over editing these
values by hand. The Skills panel's `card.module.css` is the living reference
implementation of the shared chrome.

## Page scaffold (a `settings.section` page)

```tsx
<div className={styles.page}>
  <h2 className={styles.heading}>{t('title')}</h2>
  <p className={styles.intro}>{t('intro')}</p>
  <div className={styles.tabs} role="tablist" aria-label={t('tabs')} onKeyDown={onTabKeyDown}>
    {renderTab('plugins', t('tab.plugins'))}
  </div>
  {/* ...panels, notices, filter rows, grids */}
</div>
```

```css
.page {
  max-width: 760px;
  flex-direction: column;
  gap: 12px;
  display: flex;
  color: var(--dsw-alias-label-primary);
}
.heading { margin: 0; font-size: 18px; font-weight: 600; line-height: 24px; }
.intro { color: var(--dsw-alias-label-tertiary); margin: 0; font-size: 13px; line-height: 20px; }
```

Dictionary keys: `nav` (section label), `title`, `intro`, `tabs` (tablist
aria-label) — the shell's own key set for a section.

## Underline tab strip with a roving keyboard model

```tsx
const TAB_ORDER: readonly Tab[] = ['plugins', 'marketplaces']
const tabRefs = React.useRef(new Map<Tab, HTMLButtonElement>())

/** ArrowLeft/Right move the selection, Home/End jump; selection follows focus. */
const onTabKeyDown = (event: React.KeyboardEvent): void => {
  const index = TAB_ORDER.indexOf(tab)
  const next = event.key === 'ArrowLeft' ? (index + TAB_ORDER.length - 1) % TAB_ORDER.length
    : event.key === 'ArrowRight' ? (index + 1) % TAB_ORDER.length
    : event.key === 'Home' ? 0
    : event.key === 'End' ? TAB_ORDER.length - 1
    : undefined
  if (next === undefined) return
  event.preventDefault()
  setTab(TAB_ORDER[next]!)
  tabRefs.current.get(TAB_ORDER[next]!)?.focus()
}

const renderTab = (id: Tab, label: string): React.ReactElement => (
  <button
    type="button" role="tab"
    aria-selected={tab === id}
    data-active={tab === id ? 'true' : undefined}
    tabIndex={tab === id ? 0 : -1}
    className={styles.tab}
    onClick={() => setTab(id)}
    ref={(el) => { if (el !== null) tabRefs.current.set(id, el) }}
  >{label}</button>
)
```

```css
.tabs {
  align-items: flex-end;
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
  gap: 22px;
  margin-top: 2px;
  display: flex;
}
.tab {
  appearance: none; font: inherit; font-size: 13px; line-height: 20px;
  cursor: pointer; position: relative; padding: 7px 1px 9px;
  border: 0; background: transparent; color: var(--dsw-alias-label-tertiary);
}
.tab:hover, .tab[data-active='true'] { color: var(--dsw-alias-label-primary); }
.tab[data-active='true']::after, .tab:focus-visible::after {
  background: var(--dsw-alias-label-primary); content: '';
  border-radius: 2px 2px 0 0; height: 2px; position: absolute;
  bottom: -1px; left: 0; right: 0;
}
.tab:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px; border-radius: 2px; color: var(--dsw-alias-label-primary);
}
```

## Button families (one geometry)

```css
.primary, .ghost, .ghostDanger, .danger, .updateBtn, .deleteBtn {
  appearance: none; font: inherit; font-size: 13px; line-height: 20px;
  cursor: pointer; border-radius: 8px; padding: 5px 14px;
  border: 0.5px solid transparent; white-space: nowrap;
}
.primary {
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-weight: 600;
}
.primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }
.ghost, .ghostDanger {
  background: transparent; color: var(--dsw-alias-label-secondary);
  border-color: var(--dsw-alias-border-l2);
}
.ghost:hover:not(:disabled), .ghostDanger:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
/* Second step of a destructive pair (after the ghost confirm step). */
.danger, .deleteBtn {
  background: transparent; color: var(--dsw-alias-label-error);
  border-color: var(--dsw-alias-label-error); font-weight: 600;
}
.danger:hover:not(:disabled), .deleteBtn:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
/* Warning tint lives on the text, never a fill. */
.updateBtn {
  background: transparent; color: var(--dsw-alias-state-warn-label);
  border-color: var(--dsw-alias-border-l2);
}
.primary:disabled, .ghost:disabled, .ghostDanger:disabled,
.danger:disabled, .updateBtn:disabled, .deleteBtn:disabled { opacity: 0.4; cursor: default; }
```

## Field (input / select)

```css
.input {
  font: inherit; font-size: 13px; line-height: 20px; color: inherit;
  height: 34px; border-radius: 8px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4);
  background: var(--dsw-alias-bg-layer-3);
}
.input:focus-visible, .select:focus-visible {
  border-color: var(--dsw-alias-brand-primary);
  outline: none;
}
```

## Pill badge (presence / chips)

```css
.pill {
  border: 0; border-radius: 999px; padding: 1px 8px;
  background: var(--dsw-alias-bg-module-platform);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px; font-weight: 500; line-height: 17px;
  white-space: nowrap; flex: none;
}
```

State-colored fills (success / warn) keep the pill shape and swap the label
to the constant near-black: `color: var(--dsw-static-neutral-bluish-1000);`.

## Modal (elevated surface)

```css
.overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: var(--dsw-alias-bg-mask-1);   /* 24% black light, 50% dark */
  align-items: center; justify-content: center; display: flex;
}
.modal {
  width: min(440px, calc(100vw - 48px));
  border: 0;                                 /* the shadow carries the stroke */
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-3);
  box-shadow: var(--dsw-elevation-prominent);
  padding: 20px; flex-direction: column; gap: 10px; display: flex;
}
```

## Empty state

```css
.empty { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; padding: 4px 0; }
```

## Shell icons from a client bundle

`@deepseek-ai/dsh-client-ui-primitives` is a frozen module-table entry (see
`shared/tsdown.client.ts` `PLATFORM_MODULES`), so a client bundle imports it
and it resolves from the web shell at runtime — the same way the harness's
own PluginCard draws its chevron:

```tsx
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'

React.createElement(IconChevronDownOutline14, { className: styles.chevron })
```

Declare it as a devDependency (`^0.1.2-rc.1`) for types; the build keeps it
external. Button, Input, Modal, and the other atoms are available the same
way — but note the shell's own settings pages hand-roll their card chrome in
CSS modules, so for settings surfaces the CSS above IS the native look.
