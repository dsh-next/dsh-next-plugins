# Collapse the subscription row card until it is opened

- date: 2026-09-24
- status: implemented
- scope: packages/dsh-next-oauth-providers

## Why

The seat inside a native provider row rendered its whole editor permanently:
sign-in row, Customized settings fold, Cancel, and Apply were on screen for
every configured subscription. That made the row the tallest thing on the
Models page whether or not anything was being edited, and it left **Cancel**
with nothing to mean — it discarded a draft and collapsed the settings fold,
which is invisible when neither is in play. A user reading Cancel next to Apply
expects the card to close, and reported it as broken.

## What landed

- [SubscriptionCard.tsx](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/client/SubscriptionCard.tsx)
  is a disclosure: the family name is a button carrying `aria-expanded`, and the
  editor mounts only while it is open. Collapsed, the row keeps what it can
  answer at a glance — name, credential dot, account label or status line, and
  Sign out when connected.
- Cancel and Apply both collapse the card. Apply also announces
  `Saved <provider>.` on the row (`role="status"`), because the editor that used
  to show that confirmation is gone by then.
- Collapsing unmounts `SubscriptionPanel`, so an unfinished sign-in is
  cancelled — the same rule the README already documents for closing an editor.
- [footer.module.css](/Users/rokgrabnar/Projects/dsh-next-plugins/packages/dsh-next-oauth-providers/src/client/footer.module.css)
  adds `.cardSummary`: the stock `Customized settings` disclosure at row scale
  (5x5 border chevron, 0.12s rotation, 6px chip, `interactive-bg-hover`), with
  the module's existing focus ring and the file's reduced-motion rule.

## Evidence

- Unit: the editor is absent until the toggle is clicked and absent again after
  a second click; Cancel closes without writing `addProvider` and reopens on the
  stored catalog; Apply closes and announces the save. The regression suite's
  model-editor cases now open the disclosure first.
- E2E (`mise run e2e -- oauth-providers`): the seat starts collapsed, the
  toggle opens it, Apply collapses it, and the row shows `Saved Grok.`
- Dev runtime, measured: collapsed `aria-expanded="false"` with 0 Apply
  buttons (86px tall row); after the toggle `aria-expanded="true"` with the
  editor present; after Cancel back to 0 and `"false"`.
