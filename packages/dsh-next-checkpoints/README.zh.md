# checkpoints

[English](README.md) | 中文

这是一个 DeepSeek Harness 插件：把会话恢复到某个已知的好时刻，工作区文件
和模型可见历史作为同一个检查点。在 Chat、Trajectory 旁边的 `Checkpoints` 标签
里查看工作。单击检查点可查看累计文件 diff。单击 `Rewind` 并确认后才会恢复。
选中一行永远不会恢复。

## 怎么用

1. 照常工作。会话开始时会保存一个 `Session start` 检查点，之后每一轮结束
   再保存一个。
2. 打开 `Checkpoints` 标签。检查点轨道在右侧；最新的检查点在底部。
3. 单击一行，查看截至该检查点的全部文件变更（相对会话基线的净差异）。
   再单击文件可打开 GitHub 风格的 unified 预览（带语言高亮）。
4. 在该行单击 `Rewind`。阅读确认框（之后的轮次、脏路径、HEAD 是否移动）。
   确认后恢复。
5. 要撤销第一轮对文件的改动，请回退 `Session start` — 回退到 `turn 1`
   会保留那一轮的写入。回退之后，此代后面的检查点会丢掉，Chat 会打开一个
   不含之后轮次的截断会话。原先的会话会被归档。

## 功能

### Checkpoints 标签

检查点轨道，加上文件列表。每行显示 `Created`、`Deleted` 或 `Modified` 状态
胶囊、GitHub 风格的 `+N`/`-N` 计数和五格条，已删除路径带删除线。`Files` 标题
显示该检查点的合计，格式相同。一轮进行中时，最新一行用转圈替换 `Rewind`，
文件列表和行数会实时更新。单击文件打开 GitHub 风格的 unified 预览（行号、
hunk 头、语言高亮）；预览标题在 `Close` 左侧重复文件时间和 `+N`/`-N` 条。
二进制、过大、无效 UTF-8、符号链接和目录显示为行（没有状态胶囊），不会伪装成新建。

### 一个检查点，文件和历史一起

回退把快照写回磁盘，并 fork 一个截止到该检查点的子会话，因此 Chat 不再显示
之后的轮次。它不会执行 `git reset`、`git revert` 或 `git checkout`。会话期间
产生的提交会留下。原先的会话会被归档。若它绑定了插件 worktree，该认领会
转到子会话，因此它仍是 worktree 会话。

### 如实警告

确认框会在非 Agent 脏路径将被覆盖、以及自该检查点以来 HEAD 已移动时发出警告。

## 安装

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-checkpoints
```

`<name>` 是你的 DSH profile（例如 `web`）。添加插件后请重载该 profile。

## 使用前须知

- 需要 DeepSeek Harness `0.1.2-rc.1` 或更新版本。
- 检查点不是 git。文件列表是本会话碰过的路径（write/edit 工具），不是
  `git status`。本会话创建的文件被 bash `mv` 之后，会按内容哈希跟到新路径。
  同一文件夹里其他会话改的文件不会出现。回退之后，`git status` 可能看起来
  像是之后的提交被撤销成未暂存变更 — 这是如实状态，不是故障。
- 一轮仍在进行时会拒绝回退。
- 贡献者请看 [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md)。
