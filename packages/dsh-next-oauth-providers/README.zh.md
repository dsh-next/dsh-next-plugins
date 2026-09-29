# OAuth 提供方

[English](README.md) | 中文

在 DeepSeek Harness 中使用你的 Kimi Code、Grok、ChatGPT 或 Claude 编程订阅，无需输入 API 密钥。

## 安装

- 需要 DeepSeek Harness `0.1.7-alpha.1` 或更新版本，并启用其官方模型提供方集成。使用自定义配置档案？请[检查前提条件](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/oauth-providers.md#check-a-custom-profiles-model-support>)。
- 请使用本地 Web GUI，以及有权使用提供方编程套餐的账号。

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-oauth-providers
```

将 `<name>` 替换为你的 DSH 配置档案（例如 `web`），然后用该配置档案打开 Harness。

## 快速开始

1. 在本地 Web GUI 中打开 `Settings` → `Models`。
2. 点击提供方列表下方的 `Add OAuth model provider`。
3. 选择提供方，点击 `Sign in`，然后完成浏览器或设备码登录流程。
4. 点击 `Apply`。订阅会拥有自己的提供方行，其模型会出现在现有的模型选择器中。

## 你可以做什么

- 同时使用订阅模型和 API 密钥提供方。
- 通过 `Fetch available models` 选择要显示的模型，再点击 `Add selected` 和 `Apply`。
- 在 `Capacities` 下调整模型限制和支持的输入类型，或用 `Restore defaults` 清除自定义模型目录。
- 在 `Models` 页面上，通过各订阅自己的行进行管理。

![连接 Kimi Code 账号前的 OAuth 提供方登录界面](<media/provider.webp>)

## 使用前须知

- 访问权限、用量限制及任何费用由提供方的套餐决定。登录不会赠予你尚未拥有的订阅。
- 每个提供方系列支持一个账号。`Reconnect` 会替换已保存的授权；`Delete` 会移除登录和保存的模型目录。
- 令牌保存在 DSH 凭据存储中，不会写入插件设置。请保护 DSH 主目录，不要分享凭据。关闭编辑器会取消未完成的登录，但不会撤销之前保存的授权。
- 如果某个提供方的模型加载失败，可使用 `Retry`；其他订阅仍可继续工作。

自定义目录、凭据和回调端口冲突的详情，请参阅[模型设置与登录恢复](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/oauth-providers.md>)。
开发说明请参阅[贡献者指南](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)。
