# DeepSeek Harness 通知

[English](README.md) | 中文

当 agent 完成任务、遇到问题或需要你回复时，在桌面端或浏览器中接收提醒。

## 安装

需要 DeepSeek Harness `0.1.7-rc.1` 或更新版本。

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-notifier
```

将 `<name>` 替换为你的 DSH 配置档案，例如 `web`，并使用该配置档案打开 Harness。

## 快速开始

1. 打开 `Plugins`，在已安装列表中选择 `Notifications`。
2. 保持 `Enable notifications` 开启，并选择需要提醒的事件。设置会自动保存。
3. 点击声音旁的 `Preview`，启用此设备上的音频。点击 `Test in-page toast` 旁的 `Show`，试用页面内提醒。
4. 如需后台提醒，点击 `System notifications` 旁的 `Enable`，允许通知后点击 `Test`。
5. 启动任务，然后切换到其他会话或应用。提醒出现后，使用 `Open session` 或点击系统通知返回。

## 你可以做什么

- **及时了解进展：** 接收任务完成、错误、批准请求和提问提醒。
- **选择提示音：** 为不同事件设置声音并调节音量。
- **使用多个窗口：** 已打开的客户端会协调发送，避免每个窗口都显示同一提醒。

![包含事件开关、声音和权限控件的通知设置](<media/settings.webp>)

## 使用须知

- `Mute while viewing the session` 默认开启。`Only notify when the goal completes` 也默认开启，因此活动目标中的普通完成事件不会提醒。`Subagent finished` 默认关闭。
- 请保持桌面窗口或浏览器页面打开。关闭所有客户端后，没有离线收件箱。
- 声音在你的设备上播放，而非远程 Harness 服务器。没有声音时，请尝试 `Preview`，并检查音量、静音和 `Play sound`。
- 没收到系统提醒？请检查通知权限和操作系统的勿扰设置。插件无法保证通知横幅一定显示。

[提醒行为与故障排查](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/notifier.md>) · [获取帮助](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [参与贡献](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
