# reset

[English](README.md) | 中文

这是一个 DeepSeek Harness 插件：在**同一个文件夹**里开启空白会话，并把
当前聊天归档。当对话已经被污染、但你还想继续在这里干活时，输入
`/reset` — 包括插件 worktree 和用 `git worktree add` 建出的目录。

切换本身就是确认。你不会看到 “Reset succeeded” 这一行；那句话写在旧
日志上，侧栏不再显示那一行。

## 使用方法

1. 等 agent 空闲（没有正在进行的回合，也没有排队的提示）。
2. 在输入框输入 `/reset` 并发送。
3. 聊天变为空白。侧栏仍显示原来的标题。你还在同一个文件夹里。

## 功能

### 同一文件夹，新对话

新会话使用当前工作区的目录。`git worktree add` 检出保持不变。未发送的
输入草稿会被丢弃。

### Worktree 认领保留

如果已挂载 `dsh-next-worktrees`，且当前会话拥有插件 worktree
（`/.dsh/worktrees/<slug>`），`/reset` 会把该认领交给新会话，并保持
`danger-full-access`，git 仍然可用。普通文件夹和 CLI worktree 会跳过
这一步。

### 单向归档

旧会话的 JSONL 仍留在磁盘上。DeepSeek Harness 没有取消归档的界面，所以
侧栏不会再把旧聊天递回来。

## 安装

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-reset
```

`<name>` 是你的 DSH profile（例如 `web`）。添加插件后请重新加载
profile。

## 使用前须知

- 需要 DeepSeek Harness **0.1.2-rc.1** 或更新版本，以及 **Web UI**。
  ACP 和无头会话会报错，而不会造出一个无人打开的空白会话。
- 命令是 `/reset`，不是 `/clear`。将来核心如果提供 `/clear`，含义会是
  “在本日志里忘记”，本插件不做那件事。
- 对已经空白的会话执行 `/reset` 是空操作。
- 正在运行的 agent、排队中的提示、子 agent 会话、以及没有工作目录的
  会话会被拒绝。
- 新行保留旧的话题名（标题被钉住）。不会复制 `/goal`。
- 贡献者请看 [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md)。
