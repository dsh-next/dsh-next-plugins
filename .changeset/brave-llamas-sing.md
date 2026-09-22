---
"@dsh-next/dsh-next-skills": patch
---

Skills works again on DeepSeek Harness `0.1.7-alpha.1`, which replaced the
plugin settings API this plugin stored its provider and installation records
through. DeepSeek Harness imports the old section into the active profile once,
so an existing setup keeps its providers, provenance, and installed skills.
