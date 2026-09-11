# @dsh-next/dsh-next-oauth-providers

## 0.1.0

### Minor Changes

- Added **Subscriptions** under Settings → Models: sign in to a Kimi, Grok, ChatGPT, or Claude coding subscription and pick its models in the existing model selector, no API key required. Tokens are stored in `$DSH_HOME/.credentials.yaml` and catalog edits in `settings.yaml`; Grok traffic uses the Grok coding endpoint. A subscription that cannot load now fails on its own row in the model picker and leaves the other providers, and chat on them, working.
