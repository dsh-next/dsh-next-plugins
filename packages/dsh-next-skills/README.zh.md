# @dsh-next/dsh-next-skills

[English](README.md) | 中文

一个从 Web GUI 管理 agent 技能的 DeepSeek Harness 插件：将 GitHub
仓库添加为技能提供方，把技能统一安装到全局，并通过配置控制每个技能
在哪些工作区启用。技能只安装一次，存放在全局技能根目录；项目中只保留
手工创建、纳入版本控制的技能，启用/停用绝不写入技能文件。

主设置导航中会出现一个 **Skills** 区域（与 General、Models、Plugins
同级——通过官方 `settings.section` 插槽注册），样式与 Claude Plugins
页面一致，包含两个标签页：

- **Skills** — 一个两列卡片网格，包含发现的每一个技能（项目、自定义与
  用户根目录——磁盘上已存在的卡片排在前面，各组按字母排序），以及每个
  提供方目录中的技能。搜索框、提供方筛选、仅显示已安装开关，以及
  Show more 按钮（每页 30 张卡片）让大型目录依然流畅。每张卡片显示
  名称、提供方徽标、描述、生效范围徽标（`Everywhere`、`N workspaces`
  或 `Off`）、手工创建的项目技能的 `project` 徽标，以及插件未安装技能的
  橙色 `custom` 徽标。**Add/Manage** 按钮会打开作用域弹窗：单选按钮决定
  该技能在哪里启用——Everywhere（默认）或仅在勾选的已注册工作区中——
  安装或保存都会把该作用域写为纯配置。当提供方目录出现更新时，受管理的
  卡片会带有 **Update** 按钮；弹窗中还有 Update 与两步确认的 Remove
  （仅限受管理的技能）。点击名称可以打开渲染为 markdown 的完整 SKILL.md。
- **Providers** — 管理 GitHub 技能仓库：通过 URL 添加
  （`https://github.com/owner/repo` 或 `owner/repo`）、全部刷新、移除。
  每行显示仓库描述、缓存的技能数量、最近同步时间以及同步错误。全新安装
  会预置一组默认提供方，并在启动后不久同步一次；移除会持久生效。

## 工作原理

**只安装到全局。** 安装会把技能文件复制到全局根目录
（`~/.agents/skills/<name>/`）并记录到设置中。插件绝不会向项目写入技能
文件；工作区的 `.agents/skills/`（或 `.dsh/skills/`）以只读方式扫描，
让手工创建、纳入版本控制的项目技能以 `project` 徽标出现在网格中。

**启用即配置。** 每个技能名对应一个作用域设置，决定它在哪些工作区启用：
缺省表示在所有工作区启用；一组工作区目录名表示只在文件夹名匹配的工作区
启用；空列表表示全部停用。作用域存储的是文件夹名而非绝对路径，因此即使
同事把仓库检出到不同位置，这份设置依然可用。（两个同名文件夹的注册
工作区会共享同一启用状态。）插件通过自己的 `ctx.skills`
提供方发布技能目录（每个候选都比文件系统提供方的同条目高一个优先级，
因此项目技能仍然压过同名的全局技能），并在每次查找时根据作用域解析
调用标志——被停用的技能只是两个调用标志同时关闭，因此它会从所有模型
与命令面板中消失。无需编辑 frontmatter，没有影子副本，不产生任何
文件写入。

**设置承载状态。** 提供方、已安装记录和作用域都持久化在插件自己的
设置命名空间中（`$DSH_HOME/settings.yaml` 的 `dsh-next-skills:` 键）——
可读、可手工编辑、便于在开发者之间共享。在提供方缓存同步之后，设置中
有记录但文件缺失的技能会从缓存重新安装，因此把设置小节复制给同事
（或新机器）即可复现同一套技能。

移除是可恢复的：在弹窗中确认后，受管理的技能会被移入其根目录的
`.trash` 目录（发现过程会跳过该目录），因此误删可以手动撤销。插件绝不
移除手工创建的技能。首次启动会把旧状态模型（providers.json、
frontmatter 开关、工作区影子副本、工作区安装）迁移到设置小节：受管理的
工作区副本会移入全局根目录，影子副本被删除，之前被停用的技能则以显式的
"全部停用"作用域开始。

## 提供方与缓存

提供方是任何包含技能的公开 GitHub 仓库：任意目录只要含有 `SKILL.md`
即可生效（不限深度），因此扁平布局（`skills/<name>/SKILL.md`，如
vercel-labs/skills）和嵌套布局
（`native-skills/default/<group>/<name>/SKILL.md`，如 holistics/skills）
都能工作。`.git`、`.github` 和 `node_modules` 子树会被忽略。

首次启动时，插件会预置一组默认提供方（anthropics/skills、
openclaw/openclaw、mattpocock/skills、
muratcankoylan/Agent-Skills-for-Context-Engineering、affaan-m/ecc、
nextlevelbuilder/ui-ux-pro-max-skill、addyosmani/agent-skills、
Leonxlnx/taste-skill），并在启动后不久同步一次，因此无需任何设置，
Skills 标签页即已有内容。移除默认提供方会持久生效——它们不会回来。

**速率限制。** 设置了 `DSH_GITHUB_TOKEN` 或 `GITHUB_TOKEN`
环境变量（每次同步都会重新读取）时，元数据请求会携带认证——配额为每小时
5000 次，而不是整台机器共享的未认证每小时 60 次。快照下载本身走 CDN，
无论如何都不占用该配额。

添加提供方时，所有技能都会被下载到插件自有的缓存目录
`$DSH_HOME/skills-market/` —— 它刻意位于 `$DSH_HOME/skills` 之外
（后者由 DSH 文件系统提供方扫描），因此缓存中的技能绝不会自行激活。
Skills 标签页读取该缓存；安装会把文件复制到全局根目录，并写入一个小型
清单（`.dsh-next-provider.json`）与设置记录并存。

**通过仓库快照实现快速同步。** 同步并非对每个文件各发一次请求，而是
以单次请求下载仓库默认分支的快照（`codeload.github.com`，由 CDN 支撑
且不受 API 速率限制约束），在内存中解压，并提取出每个含 `SKILL.md`
的目录。技能的版本就是内容哈希，因此刷新只会重新复制文件发生变化的
技能。元数据（仓库描述和星标数）来自一次低成本的 API 调用。这让即使
是大型默认提供方也远在 GitHub 未认证 60 次/小时的限额之内，首次同步
只需数秒。

**变更检测**会将这些内容哈希版本与已安装技能记录的版本进行比较：
两者不一致时，卡片会显示"更新"按钮；更新会覆盖文件（清理掉上游已
消失的文件），保持清单与设置记录为最新，且不改动作用域。刷新是手动的
（按提供方或"全部刷新"）且仅用于检测：不经点击，任何内容都不会被
安装或覆盖。

## 安装

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-next-skills
```

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

在仓库根目录下使用 `mise run e2e` 运行真实挂载冒烟测试。
