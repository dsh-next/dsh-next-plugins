# dsh-next-notifier

[English](README.md) | 中文

一个 DeepSeek Harness 插件，通过页面内弹窗、浏览器通知和可选声音，提醒你 agent 已完成任务、因问题停止或需要你的输入。

## 如何使用

1. 使用下方命令安装插件，然后打开该配置档案的 Web GUI。
2. 打开 `Settings` → `Plugins` 并展开 `Notifier`。保持 `Enable notifications` 开启，选择需要的通知类别和声音。
3. 点击 `Test in-page toast` 旁的 `Show`。如需后台提醒，点击 `Test browser notification` 旁的 `Enable`，允许浏览器通知权限，再点击 `Test`。
4. 启动任务，然后切换到另一个会话或将窗口置于后台。`Mute while viewing the session` 默认开启，因此正在查看触发事件的会话时，实际提醒会保持静默。
5. 点击提醒打开对应会话。使用关闭按钮（也支持键盘操作）关闭弹窗，或等待它在 12 秒后自动消失。

![深色主题 DSH GUI 中的 Notifier 设置](media/settings.webp)

## 功能

### 清楚说明发生了什么

主 agent 的提醒区分 `Agent finished`、`Agent error`、`Agent blocked` 和 `Agent reached token limit`。取消或中断的回合保持静默。终止提醒会等待两秒空闲期；agent 恢复运行或被释放时，会取消其待发送提醒。

`Approval needed` 和 `Question asked` 表示仍在等待人工回复，而不只是调用了某个工具。200 毫秒内结束的请求保持静默；请求结束或被中止时，待发送提醒会被撤回。

开启 `Subagent finished` 即可接收子 agent 运行的终止提醒；此选项默认关闭，子 agent 的状态变化不会被误报为主 agent 完成。`Only notify when the goal completes` 默认开启：当目标处于活动状态且已启用自动继续时，它会抑制普通完成提醒，但不会抑制错误提醒。目标完成或受阻只产生一条目标提醒，不会再重复发送回合完成提醒。

### 多标签页协调送达

可见且聚焦的页面会显示页面内弹窗，无需浏览器权限。否则，拥有权限的后台页面可以显示浏览器通知。多个已打开的客户端会协调送达，让每条提醒同时只由一个客户端负责，并优先选择聚焦页面。

如果后台浏览器通知不可用或未获授权，只要页面仍存活，提醒就可以等待最多 120 秒，以便在页面回到前台时显示弹窗。此插件没有离线收件箱：没有已打开客户端时产生的事件会被丢弃，关闭所有页面也不会为下次打开保留待发送提醒。

### 收到送达确认后才播放声音

自动提示音仅在可见弹窗完成渲染，或浏览器报告通知已显示后才会播放。浏览器通知会请求关闭原生提示音，避免重复发声。浏览器确认无法证明桌面横幅实际出现：操作系统通知设置或勿扰模式可能在浏览器 API 无法感知的情况下隐藏横幅。

声音在运行 DSH 的机器上播放：macOS 使用 `afplay`，Windows 使用 PowerShell `Media.SoundPlayer`，Linux 使用 `paplay` / `aplay`。远程 DSH 宿主不会在你的浏览器设备上播放这些声音。

### 选择声音

`Agent finished`、`Approval needed` 和 `Question asked` 类别均提供启用开关、`Play sound` 和 `Sound` 选择器。选择声音后会保存并试听。`Volume` 范围为 0–100；停止调整 600 毫秒后，最新数值会被保存并试听。保存或试听失败会显示在卡片中。`Show details` 显示检测到的声音播放器和焦点跟踪状态。

声音库包含 17 个合成声音，无需下载音频。

| 分组 | 声音 |
| --- | --- |
| 铃声 | `Chime`、`Ping`、`Bell` |
| 警报 | `Alert`、`Error`、`Success` |
| 音效 | `Chirp`、`Pop`、`Knock`、`Whoosh`、`Magic`、`Blip`、`Ring`、`Gong` |
| 屁声 | `Fart · Classic`、`Fart · Deep`、`Fart · Squeaky` |

默认值：完成 = `Chime`，批准 = `Ping`，提问 = `Chirp`。

## 安装

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-notifier
```

将 `<name>` 替换为你的 DSH 配置档案，例如 `web`，并使用相同的配置档案打开 DSH。

## 须知

- 此插件面向 DSH Web GUI；声明的最低 DSH 版本为 `0.1.1-rc.1`。请保持页面打开以接收提醒。
- 未收到提醒？请检查 `Enable notifications`、类别开关、`Mute while viewing the session`、浏览器权限和操作系统通知设置。没有声音？请检查 `Play sound`、`Volume` 以及 `Show details` 下的声音播放器。
- Windows 播放仅有契约测试覆盖；实际 Windows 播放仍需验证。浏览器测试按钮不能保证操作系统显示横幅。
- 本地开发和验证请参阅 [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md)。
