# worktrees

[English](README.md) | 中文

这是一个 DeepSeek Harness 插件：让两个 agent 在同一个 git 仓库上工作，而不
互相覆盖。每个会话拥有独立的文件夹与分支。工作就绪后，用 `Merge…` 把这些
提交合入主文件夹当前检出的分支。若分支会冲突，选择
`Resolve in this session`，由本会话中的 agent 先修好文件。

![创建 worktree、在该会话中工作、合并、然后清理](media/loop.webp)

## 怎么用

1. 在侧边栏里，你的 git 仓库那一行，单击分支图标（`+` 旁边）。新的
   worktree 会作为会话嵌套在该仓库之下打开。
2. 只在该会话里改代码。主文件夹仍留在自己的分支上。
3. 准备好后打开 `Merge…`。插件会先检查。若分支会冲突，选择
   `Resolve in this session` — 由本会话解决冲突并提交。之后再合并就是快进。
4. 保留 worktree 或删掉它。分支和会话记录都会留下。

![嵌套在 harbor 仓库下的 worktree 会话](media/sidebar.webp)

## 功能

### 创建

一键完成。名称自动生成。会话在新的检出中打开。

![带有创建 worktree 按钮的仓库行](media/create.webp)

### 状态

分支图标即状态：干净时为灰色，有未提交改动为琥珀色，领先基线为蓝色
（附提交计数），已合并为绿色，合并进行中为红色。

![五种 worktree 行：干净、未提交、领先、已合并、冲突](media/status.webp)

### 行菜单

会话的 `...` 菜单会加上 `Refresh`（重新读取 git 状态）、
`Update from <branch>…`（把该分支合入这个 worktree）、
`Merge…` 和 `Delete worktree…`。

![含 Refresh、Update from main、Merge、Delete worktree 的会话菜单](media/menu.webp)

### 悬停详情

将指针移到 worktree 会话上，可看到标题、分支和状态。

![显示分支与领先状态的悬停卡片](media/hover.webp)

### 合并与冲突

`Merge…` 会先确认两侧都已提交、合并能够成功，再把 worktree 合入当前分支。
若会冲突，下一步是 `Resolve in this session`：插件把主分支合并 *进
worktree*（绝不会反向），由本会话修好文件，再快进合并。合并进行中时对话框
提供 `Abort merge`。关掉对话框不会中止；主文件夹始终不被留在合并中途。

![冲突、解决、进行中、已合入 四个合并对话框](media/merge-flow.webp)

### 删除

删掉多余的文件夹。分支和会话记录保留。有未提交改动的 worktree 需要第二次
确认（`Remove anyway`）。

![提示有未提交改动的删除 worktree 对话框](media/delete.webp)

### 未使用的 worktree

从未开始过的 worktree 会在你切到另一个会话时被移除。有未提交改动的
worktree 绝不会这样被移除。

## 可选的本地文件

`.worktreeinclude` 是可选的。若你在仓库根目录提交了该文件（每行一个相对
路径），列出的文件会在每次**新建** worktree 时从主文件夹复制进去。用来带上
git 不跟踪的本地文件，例如 `.env`。源文件不存在则跳过。它只复制文件，
不会运行安装命令。

![.worktreeinclude 示例，列出 .env 与 .env.local](media/worktreeinclude.webp)

## 创建后的命令（可选）

单击分支图标创建 worktree 时，若仓库根目录有 `.worktrees.json`（或本机
`.dsh/worktrees.json`），其中的 `setup-worktree` 会自动在新文件夹里执行。
不需要再点别的。`$ROOT_WORKTREE_PATH` 是主文件夹。命令失败会取消创建并
删掉多余的文件夹。被 gitignore 的写入（`.env`、`node_modules`）不算未提交
改动。git 能看见的文件（未被 ignore）会算，此时要先提交或删掉才能 Merge
或 Update。

```json
{
  "setup-worktree": [
    "pnpm install",
    "cp \"$ROOT_WORKTREE_PATH/.env\" .env"
  ]
}
```

一般只用 `setup-worktree` 即可。`setup-worktree-unix` 和
`setup-worktree-windows` 是可选的，仅当各系统命令不同时才需要。字符串值
表示相对于该 JSON 文件的脚本路径。两个文件都存在时，`.dsh/worktrees.json`
优先。

## 安装

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-worktrees
```

`<name>` 是你的 DSH profile（例如 `web`）。

## 使用前须知

- 需要 DeepSeek Harness `0.1.2-rc.1` 或更新版本。
- 不要与其他会替换侧边栏的插件一起安装。
- 插件从不撰写提交说明。由本会话中的 agent 提交。
- 贡献者请看 [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md)。
