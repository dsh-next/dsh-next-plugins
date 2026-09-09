# worktrees

[English](README.md) | 中文

这是一个 DeepSeek Harness 插件：让两个 agent 在同一个 git 仓库上工作，而不
互相覆盖。每个会话拥有独立的文件夹与分支。工作就绪后，用 `Merge to <branch>` 把这些
提交合入主文件夹当前检出的分支。若分支会冲突，选择
`Resolve in this session`，由本会话中的 agent 先修好文件。

![创建 worktree、在该会话中工作、合并、然后清理](media/loop.webp)

## 怎么用

1. 在侧边栏里，你的 git 仓库那一行，单击分支图标（`+` 旁边）。给文件夹
   起个名字。新的 worktree 会作为嵌套的集群出现在该仓库之下，里面有一个
   会话。
2. 只在该会话里改代码。集群上的 `+` 会在同一份文件上再开一个聊天。主
   文件夹仍留在自己的分支上。
3. 准备好后，在集群的 `...` 菜单里打开 `Merge to <branch>`。插件会先检查。若分支会
   冲突，选择 `Resolve in this session` — 由本会话解决冲突并提交。之后再
   合并就是快进。
4. 保留 worktree 或删掉它。分支和会话记录都会留下。

![嵌套在 harbor 仓库下的 worktree 会话](media/sidebar.webp)

## 功能

### 创建

分支图标会打开一个名称字段（已填好建议）。请使用小写字母、数字和连字符
（`update-plugin`）。该名称同时是侧边栏标题和磁盘上的文件夹名。名称合
法之前，创建按钮不可用。集群会出现在仓库行下；如果项目有 setup 命令，
该行的分支图标会旋转，直到命令结束。

![带有创建 worktree 按钮的仓库行](media/create.webp)

### 查找会话

使用侧边栏的 `Search sessions` 并选择一个结果。搜索会关闭，并滚动到该
会话。如果是 worktree 会话，其仓库和集群会自动展开，包括折叠列表中
隐藏的会话。在 `In one list` 视图中也可使用此功能。

### 状态

分支图标即状态：干净时为灰色，有未提交改动为琥珀色，领先基线为蓝色
（附提交计数），已合并为绿色，合并进行中为红色。

![五种 worktree 行：干净、未提交、领先、已合并、冲突](media/status.webp)

### 集群菜单

文件夹的 `...` 菜单保留系统自带的 `Rename`，然后加上 `Refresh`（重新读取
git 状态）、`Update from <branch>`（把该分支合入这个 worktree）、
`Merge to <branch>` 和 `Delete worktree`（用来替代系统自带的 `Delete workspace`）。
会话的 `...` 菜单仍是系统自带的（`Rename` / `Fork` / `Archive`）。文件夹
上的 `+` 会在同一个 worktree 里再开一个会话。`Merge to <branch>` 显示
主文件夹当前检出的分支（例如 `Merge to main`）。

![含 Refresh、Update from main、Merge to main、Delete worktree 的工作树菜单](media/menu.webp)

### 悬停详情

将指针移到集群上，可看到标题、分支、状态，以及
`N sessions, same files`。

![显示分支与领先状态的悬停卡片](media/hover.webp)

### 合并与冲突

`Merge to <branch>` 会先确认合并能够成功，再把 worktree 合入当前分支。未提交的文件
会列出来；你仍可以合并。若主文件夹里的文件会被覆盖，git 会拒绝。
工作树里未提交的更改不会被合入。若分支会冲突，下一步是
`Resolve in this session`：插件把主分支合并 *进
worktree*（绝不会反向），由本会话修好文件，再快进合并。合并进行中时对话框
提供 `Abort merge`。关掉对话框不会中止；主文件夹始终不被留在合并中途。

![冲突、解决、进行中、已合入 四个合并对话框](media/merge-flow.webp)

### 删除

删掉多余的文件夹。分支和会话记录保留。有未提交改动的 worktree 需要第二次
确认（`Remove anyway`）。下一次 Create 会建议一个可用名称，必要时加上
数字（`nimble-falcon-2`）。建议名称会避开现有文件夹和保留的 worktree
分支。自己输入的名称也必须尚未被占用。

![提示有未提交改动的删除 worktree 对话框](media/delete.webp)

### 未使用的 worktree

切换离开从未开始的会话时，空白聊天可能会隐藏，但 worktree 文件夹和
侧边栏集群会保留。即使把所有聊天归档，它们也会保留。用集群上的 `+`
再开一个会话，或在想要移除文件夹时选择 `Delete worktree`。

## 可选的本地文件

新的 worktree 是一次干净的 git 检出。git 不跟踪的文件仍留在主文件夹里 —
`.env`、`.env.local` 以及其他本地密钥。新会话一开始会没有这些文件。

若这些文件必须出现在每个新建的 worktree 里，就在仓库根目录提交
`.worktreeinclude`。每行一个相对路径（`#` 开头为注释）。创建时，插件会把
列出的每个文件从主文件夹复制到新文件夹。

```
.env
.env.local
```

适合使用的情况：

- 应用或会话需要 git 忽略的本地文件（常见：`.env`）
- 每个新 worktree 都应从主文件夹拿到同一份副本
- 你可以提交路径列表（而不是密钥文件本身）

不必使用的情况：

- 没有被 gitignore 的本地文件需要复制
- 缺的是安装或生成的内容（`node_modules`、`lib/`）— 那属于创建后的命令
- 每个 worktree 应有一份你手工创建的文件

源文件不存在则跳过。它只复制文件，不复制整个文件夹，也不会运行安装命令。

![.worktreeinclude 示例，列出 .env 与 .env.local](media/worktreeinclude.webp)

## 创建后的命令（可选）

单击分支图标创建 worktree 时，若仓库根目录有 `.worktrees.json`（或本机
`.dsh/worktrees.json`），其中的 `setup-worktree` 会自动在新文件夹里执行。
新会话行会先出现；随后 setup 运行，该行的分支图标会旋转。不需要再点别的。
`$ROOT_WORKTREE_PATH` 是主文件夹。命令失败时工作树和会话会保留；错误里会
显示命令输出，你可以自行再跑 setup，或删除该工作树。被 gitignore 的写入（`.env`、`node_modules`）不算未提交
改动。git 能看见的文件（未被 ignore）会算：Update 会等到你提交或删掉；
Merge 会列出它们，但仍可继续。

命令放这里（例如 `pnpm install`）。setup 在新文件夹里运行，并去掉主仓
npm/pnpm workspace 的环境变量，这样嵌套 worktree 不会被当成缺失的
workspace 包。复制 `.env` 这类本地文件请用 `.worktreeinclude`。

```json
{
  "setup-worktree": [
    "pnpm install"
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
