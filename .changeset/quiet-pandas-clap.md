---
"@dsh-next/dsh-next-oauth-providers": major
---

**Breaking**: Provider configuration moved from `settings.yaml` into this
plugin's own configuration, because DeepSeek Harness `0.1.7-alpha.1` retired the
plugin settings API this plugin used. DeepSeek Harness imports the old section
into the active profile once, so an existing setup keeps its providers and
sign-ins.

On `0.1.7-alpha.1` the plugin works again. Its one entry point is **Add OAuth
model provider**, a dashed button directly under the stock add button on the
**Models** page with no heading of its own: once a subscription is signed in it
becomes a row on that page, with the same status dot, Edit, card, and Delete
actions as any other provider, instead of a second copy inside a Subscriptions
section. The row's name opens the plugin's own card, where the subscription
signs in and its model catalog is edited; **Cancel** or **Apply** closes it
again. The minimum supported Harness is now `0.1.7-alpha.1`.
