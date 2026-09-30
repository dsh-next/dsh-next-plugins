# @dsh-next/dsh-next-oauth-providers

## 0.2.0

### Minor Changes

- Customize model input types and reasoning capabilities in the Models editor or plugin configuration. Enable image input, disable reasoning, or map supported thinking levels to provider values; omitted fields retain the existing catalog defaults.
- Subscription sign-in now lives directly on the stock **Models** page. A single
  **Add OAuth model provider** button sits under the stock add button, with no
  separate heading or intro line in between, and each configured subscription is a
  provider row whose name opens the plugin's card. That card starts collapsed,
  showing the account or sign-in state together with **Sign out** when signed in,
  and **Cancel** or **Apply** closes it again.
- **Breaking:** OAuth provider configuration now lives in the plugin's profile configuration instead of the legacy settings section and requires DeepSeek Harness 0.1.7-alpha.1 or newer. Harness imports the legacy section into the active profile, preserving providers and sign-ins.

### Patch Changes

- Cancel now closes the Add-provider editor. Applying customized models closes the settings disclosure, confirms the save, and shows the persisted model catalog when reopened.
- Show readable English and Chinese plugin names, concise descriptions, and distinct icons in the Harness plugin manager.
- Fixed the **Edit** card on a subscription row in the stock **Models** page,
  which could render only a bare "unresolvable settings path" error and offered no
  way to close it.
- Fixed rendering of OAuth provider controls and the Skills folder menu on the current Harness interface.
- Fixed image prompts on supported ChatGPT, Grok, Kimi, and Claude subscription models, which could fail with "Image request width must be a positive integer" while text prompts still worked.

## 0.1.0

### Minor Changes

- Added **Subscriptions** under Settings → Models: sign in to a Kimi, Grok, ChatGPT, or Claude coding subscription and pick its models in the existing model selector, no API key required. Tokens are stored in `$DSH_HOME/.credentials.yaml` and catalog edits in `settings.yaml`; Grok traffic uses the Grok coding endpoint. A subscription that cannot load now fails on its own row in the model picker and leaves the other providers, and chat on them, working.
