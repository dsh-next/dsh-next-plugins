# OpenCode Go 会话修复

[English](README.md) | 中文

为 OpenCode Go 请求补上必需的会话标识，修复 `MissingSessionID` 错误。

## 安装

**私有且尚未发布。** 需要 DeepSeek Harness `0.1.1-rc.1` 或更新版本。发布后可使用：

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-opencode-session-patch
```

将 `<name>` 替换为你的 DSH 配置档案，例如 `web`。你仍需在 Harness 中配置 OpenCode Go；本插件不会添加账户或模型。

## 快速开始

1. 使用包含此插件的配置档案打开 Harness，并选择已配置的 OpenCode Go 模型。
2. 发送消息。插件会自动添加必需的会话请求头；请求应不再因缺少该请求头而失败。

## 插件的作用

- **添加会话信息：** 向 `https://opencode.ai/zen/go` 发出的请求包含当前会话 ID。
- **不影响其他提供商：** 其他端点的请求保持不变。
- **后台运行：** 没有设置页面，也无需额外按钮。

## 使用须知

- 此插件处理会话 ID 缺失问题，不解决身份验证、计费或其他提供商错误。
- 它修改的是 Harness 宿主进程中的网络请求，而非浏览器请求。agent 回合之外的请求使用回退 ID `dsh`。

[技术细节](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/opencode-session-patch.md>) · [获取帮助](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [参与贡献](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
