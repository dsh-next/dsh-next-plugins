---
"@dsh-next/dsh-next-oauth-providers": patch
---

Image prompts work again on ChatGPT, Grok, Kimi and Claude subscriptions. The
routes compiled against an older DeepSeek Harness SDK than the one the harness
runs, so every image turn failed with "Image request width must be a positive
integer" while text turns on the same route kept working.
