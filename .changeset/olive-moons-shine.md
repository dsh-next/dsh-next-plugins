---
"@dsh-next/dsh-next-notifier": patch
"@dsh-next/dsh-next-oauth-providers": patch
"@dsh-next/dsh-next-skills": patch
---

Adapted the browser UI to DeepSeek Harness `0.1.7-alpha.1`, whose shell renamed
its icon components (`Icon*Outline16` and `Icon*Outline14` became
`Icon*OutlineRegular`). On that Harness the Notifier card, the OAuth providers
section, and the Skills folder menu no longer crash while rendering, and each
package now declares DSH `0.1.7-alpha.1` as its minimum version.
