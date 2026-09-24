---
"@dsh-next/dsh-next-oauth-providers": major
---

**Breaking**: Provider configuration moved from `settings.yaml` into this
plugin's own configuration, because DeepSeek Harness `0.1.7-alpha.1` retired the
plugin settings API this plugin used. DeepSeek Harness imports the old section
into the active profile once, so an existing setup keeps its providers and
sign-ins.

On `0.1.7-alpha.1` the plugin works again. A signed-in subscription is a row on
the stock **Models** page, with the same status dot, Edit, card, and Delete
actions as any other provider, instead of a second copy inside a Subscriptions
section of its own. The minimum supported Harness is now `0.1.7-alpha.1`.
