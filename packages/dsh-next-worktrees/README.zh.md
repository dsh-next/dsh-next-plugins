# worktrees

[English](README.md) | 中文

DeepSeek Harness 插件：为并行 agent 会话提供隔离的 git 工作树。空白会话
composer 上的 "Isolated" 开关会创建一个 git 工作树并让会话在其中启动；
会话头部的状态胶囊显示分支、领先提交数与状态，并提供同级工作树导航、
复制操作和安全移除。落地保持纯 git —— 插件从不在你的分支上提交或合并。

工作树中的会话以完整文件访问权限运行（仅该会话的沙箱旋钮切换为
`danger-full-access`），因为链接工作树把 git 元数据存放在工作树之外的
共享 `.git` 中；审批提示保持开启。工作树位于
`<repo>/.dsh/worktrees/<slug>`，分支为 `dsh-worktrees/<slug>`，基线为
`origin/HEAD`（本地 `HEAD` 回退）；仓库根目录的 `.worktreeinclude` 文件
列出复制到每个新工作树的额外未跟踪文件（例如 `.env`）。

在主检出中落地工作：

```sh
git merge dsh-worktrees/<slug>
```

## 安装

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-next-worktrees
```

## 开发

```sh
pnpm build
pnpm typecheck
pnpm test
```
