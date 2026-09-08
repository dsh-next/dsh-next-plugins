# Subscription catalog capacities in the editor

Date: 2026-09-08
Status: implemented
Package: `@dsh-next/dsh-next-oauth-providers`

Customized settings showed hardcoded 256K / 64K placeholders because `ModelView` and `draftsOf` dropped `contextWindow` / `maxTokens`. Grok 4.6 in pi-ai is 500K context and 500K max output. Those catalog capacities now travel through `state()`, Fetch merge, and `configuredMaxTokens`.
