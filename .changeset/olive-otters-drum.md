---
"@dsh-next/dsh-next-notifier": patch
---

Notifications work again on DeepSeek Harness `0.1.7-alpha.1`, which replaced the
plugin settings API this plugin persisted its configuration through. The chosen
categories, sounds, and volume are imported into the active profile, so an
existing setup keeps them.
