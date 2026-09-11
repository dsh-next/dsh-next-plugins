---
"@dsh-next/dsh-next-skills": major
---

**Breaking**: Skills management is now global-only. Install skills directly without scope controls. Legacy Skills scope settings, including workspace restrictions and disabled entries, no longer apply; installed skills are available globally according to their own invocation settings. Existing files, providers, and installation records are preserved. Integrations must use the global install/remove interface instead of the removed skill-scope methods. Install requests no longer interpret or validate scope fields; all installations are global.
