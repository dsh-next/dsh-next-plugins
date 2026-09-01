# @dsh-next/dsh-next-skills

[English](README.md) | 中文

一个从 Web GUI 管理 agent 技能的 DeepSeek Harness 插件：将 GitHub
仓库添加为技能提供方，在本地搜索其中的技能，并可将它们安装到全局或
单个工作区。

主设置导航中会出现一个 **Skills** 区域（与 General、Models、Plugins
同级——通过官方 `settings.section` 插槽注册），包含三个标签页：

- **Installed** — 列出从 DSH 技能根目录中发现的技能。每行显示技能标题
  及其右对齐的作用域徽标（`⭐ Global` 或所属工作区的名称，外加
  `· disabled` / `· shadow` 标记），标题下方的徽标显示提供方名称
  （当技能并非从某个提供方安装时，显示橙色 `custom` 徽标）、技能描述，
  以及下方的按钮行：Enable/Disable（启用时为红色 `Disable`，关闭时为
  绿色 `Enable`）、需确认弹窗的 Remove、Update（始终可见，技能已是最新
  时置灰），以及多份副本过期时的 Update all copies。已停用的技能只会让
  标题和描述变暗。
- **Search** — 在来自各个提供方的缓存技能中搜索（离线且即时），配有
  搜索栏、提供方筛选下拉框和安装目标选择器（全局或特定工作区）。结果
  渐进加载（无限滚动，每次 30 条），因此大型目录也能保持快速。每行会
  标明该技能已安装的位置（`in global`、`in 2 workspaces`、……），并
  针对每个目标提供 Install，因此同一个技能可以独立存在于多个工作区。
  点击某个技能会打开详情弹窗，展示其完整的 SKILL.md 配置：名称、描述、
  调用标志和 markdown 正文（已安装的行会为自己的副本打开同一弹窗）。
- **Providers** — 管理 GitHub 技能仓库：首次启动即附带一组默认提供方
  （可移除），可通过 URL 添加更多（`https://github.com/owner/repo` 或
  `owner/repo`），可刷新单个提供方或全部提供方，也可移除。每行显示仓库
  描述、星标数（`★`）以及已缓存的技能数量。

## 工作原理

该插件管理的正是 DSH 文件系统技能提供方所扫描的那套磁盘技能根目录，
因此变更无需重启即可对运行中的 agent 生效：

| 作用域 | 根目录 |
| --- | --- |
| 工作区 | `<workspace>/.agents/skills/`（以及 `.dsh/skills/`） |
| 全局 | `~/.agents/skills/`（以及 `$DSH_HOME/skills/`） |

启用/停用使用 SKILL.md 原生 frontmatter 标志
（`disable-model-invocation`、`user-invocable`）。按作用域划分的行为：

- **按工作区安装** — 以工作区为目标安装时，会向该工作区的根目录写入
  一份独立副本；其他副本不受影响。
- **按工作区停用** — 选中某个工作区时，关闭一个全局技能会在该工作区
  放置一份 *shadow*（影子）副本（优先级高于用户根目录），仅在该工作区
  将其停用；该行会带有 `shadow` 徽标，重新开启即可移除影子副本。选择
  "Global only" 可切换全局副本本身。
- **按工作区删除** — 选中某个工作区时，Remove 只会将该工作区中的副本
  移入回收站；全局副本和其他工作区仍保留各自的副本。
- **在所有位置更新** — 安装在多个位置的技能可以逐个副本更新，也可以
  通过 Update all copies 一次性全部更新：全局副本和每个工作区副本在
  单次调用中一起刷新，且各自保留自己的启用/停用状态（非提供方安装的
  副本以及影子副本会被跳过并报告）。

移除是可恢复的：确认弹窗后，技能会被移入其所在根目录的 `.trash`
目录（发现过程会跳过该目录），因此误删可以手动撤销；插件生成的工作区
影子副本则会被直接删除。提供方的移除同样由该弹窗确认（缓存会被删除；
已安装的技能保留）。

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
Search 标签页即已有内容。移除默认提供方会持久生效——它们不会回来。

添加提供方时，所有技能都会被下载到插件自有的缓存目录
`$DSH_HOME/skills-market/` —— 它刻意位于 `$DSH_HOME/skills` 之外
（后者由 DSH 文件系统提供方扫描），因此缓存中的技能绝不会自行激活。
配置的提供方列表会持久化在缓存旁边（`providers.json`）。Search
标签页读取该缓存；安装会把文件复制到所选技能根目录，并写入一个小型
清单（`.dsh-next-provider.json`），记录提供方与已安装的版本。

**通过仓库快照实现快速同步。** 同步并非对每个文件各发一次请求，而是
以单次请求下载仓库默认分支的快照（`codeload.github.com`，由 CDN 支撑
且不受 API 速率限制约束），在内存中解压，并提取出每个含 `SKILL.md`
的目录。技能的版本就是内容哈希，因此刷新只会重新复制文件发生变化的
技能。元数据（仓库描述和星标数）来自一次低成本的 API 调用。这让即使
是大型默认提供方也远在 GitHub 未认证 60 次/小时的限额之内，首次同步
只需数秒。

**变更检测**会将这些内容哈希版本与已安装技能清单中记录的版本进行
比较：两者不一致时，Installed 标签页会显示 Update 按钮；更新会覆盖
文件（清理掉上游已消失的文件），保持清单为最新，并重新应用你的
启用/停用状态，使已停用的技能保持停用。刷新是手动的（按提供方或
Refresh all）且仅用于检测：不经点击，任何内容都不会被安装或覆盖。

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
