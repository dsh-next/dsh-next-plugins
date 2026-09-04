# dsh-next-notifier

[English](README.md) | 中文

一个 DeepSeek Harness 插件：当 agent 完成回合、需要你的批准或向你提问时提醒你——
你正在查看页面时显示**页面内弹窗（toast）**，窗口最小化或处于后台时显示
**浏览器（网页）通知**；并在**设置 → 插件**中提供一张配置卡片，附带精选的
声音库。

## 触发器

| 触发器 | 通知 |
| --- | --- |
| Agent 完成回合 | "Agent finished its turn." |
| Agent 请求批准 | "Approval needed — Waiting for your approval: `<tool>`" |
| Agent 调用 `ask_user_question` | "Question — The agent asked you a question…" |
| Subagent 完成回合（可选开启） | "A subagent finished its turn." |
| 会话目标完成 | "Goal completed — The session goal completed." |
| 会话目标被阻塞 | "Goal blocked — The session goal was blocked: `<reason>`" |

## 配置界面

设置 → 插件中的卡片提供：

- **启用通知** — 一切的总开关。
- **查看会话时静音** — 默认开启：当聚焦窗口显示的正是触发通知的那个会话时，
  保持安静。
- **音量** — 0–100 滑块，作用于所有通知声音。响度在合成 WAV 时已固化其中
  （感知 `(v/100)^2` 增益），因此所有播放器都会遵循。
- **按类别分组**（Agent 完成 / 需要批准 / 提出问题），每组包含：通知、播放
  声音和一个声音下拉菜单（选中时预览）。完成组额外提供 **Subagent 完成**
  （可选开启）和 **仅在目标完成时通知**（默认开启）。
- **测试浏览器通知** — 验证网页层，并在首次使用时请求权限。
- **测试页面内弹窗** — 在页面内显示一条示例弹窗。
- **显示详情** — 后端声音播放器状态行与实时焦点跟踪行。

更改立即生效，并持久化到设置文档中 `dsh-next-notifier` 命名空间之下。

## 声音库（17 个合成声音）

不附带任何音频资源：每个声音都在启动时合成为 WAV（16 位 PCM、22.05 kHz
单声道），并写入操作系统临时目录。

| 分组 | 声音 |
| --- | --- |
| 铃声 | Chime、Ping、Bell |
| 警报 | Alert、Error、Success |
| 音效 | Chirp、Pop、Knock、Whoosh、Magic、Blip、Ring、Gong |
| 屁声 | Fart · Classic、Fart · Deep、Fart · Squeaky |

默认值：完成 = Chime，批准 = Ping，提问 = Chirp。

播放方式：`afplay`（macOS）/ 通过 PowerShell 的 `Media.SoundPlayer`
（Windows）/ `paplay` 或 `aplay`（Linux），与网页通知一同播放。

## 送达

提醒通过适合你当前状态的渠道送达：

- **正在查看页面**（窗口聚焦且可见）：**页面内弹窗（toast）**从窗口顶部滑入。
  点击弹窗打开对应会话，关闭按钮将其移除，弹窗 12 秒后自动消失。弹窗无需
  浏览器权限。
- **处于后台或最小化**：带 DeepSeek 图标的**浏览器（网页）通知**——窗口不在
  视线内时由操作系统显示。
- **页面已关闭**：该提醒被丢弃。

每条提醒的标题为 **emoji 图标 + 事件类型**（例如 "⚠️ Approval needed"、
"✅ Agent finished"），**正文为会话标题**（例如 "Design spec"），一眼即可
看出发生了什么、属于哪个会话。点击任一渠道都会打开该会话。

## 架构

- **宿主**（`src/index.ts` + `src/host/`）— 注册设置命名空间（Schemastery
  schema），监听 `agent/status`、`subagent/end`、`approval/request`、
  `tools/execute` 和 `goal/changed`，并在 `POST /dsh-next-notifier/rpc`
  提供 RPC 路由。
- **客户端**（`src/client/`）— `settings.plugin.item` 中的设置卡片、在线
  状态上报、网页通知排空器，以及注册在 shell 的 `shell.overlay` 插槽中的
  页面内弹窗层。
- **核心**（`src/core/`）— 纯共享逻辑：配置规范化、WAV 合成与通知判定，
  无需运行时即可进行单元测试。

## 安装

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-notifier
```

## 开发

```sh
pnpm build
pnpm typecheck
pnpm test
```
