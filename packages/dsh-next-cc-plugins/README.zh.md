# cc-plugins

[English](README.md) | 中文

DeepSeek Harness 插件：添加 [Claude Code](https://code.claude.com/docs/en/plugins)
插件市场并在 DSH 中运行其中的插件 —— 与 Claude Code（`/plugin marketplace add`）
和 Grok Build（`grok plugin marketplace add`）提供的同一套应用商店流程相同，
桥接到 DSH 的原生界面之上，并为 DSH 在进程内激活的组件提供内置运行时。

## 功能

- **添加市场** —— 官方 Anthropic 市场（`anthropics/claude-plugins-official`，
  约 290 个插件）在**全新安装时预置**，因此“插件”标签页会立即列出插件；
  移除是最终性的（预置仅在注册表文件首次存在之前生效）。其他来源由你自行
  添加：GitHub 仓库（owner/repo 简写、GitHub HTTPS/SSH URL），或持有
  `.claude-plugin/marketplace.json` 索引的本地目录（`.grok-plugin/marketplace.json`
  被接受为 Grok Build 互操作的回退形式）。浏览每个市场的插件及其组件清单、
  刷新、移除。超过 24 小时的快照会在面板每次打开时自动重新同步（尽力而为：
  刷新失败会保留缓存的目录），每个来源显示其上次同步的时间，而“全部刷新”
  会强制立即重新同步——逐个来源进行，当前行的“移除”按钮会替换为旋转指示，
  按钮上显示逐来源的进度计数，因此你始终知道哪个市场正在下载。
- **浏览并安装插件** —— “插件”标签页以双列卡片网格列出所有市场中的每个
  插件（已安装的插件排在前面，每组按名称字母序排列），并提供搜索、市场
  过滤器和“仅已安装”开关，并由 Show more 按钮（每页 30 张卡片）保证大型
  目录依然流畅。已安装的卡片显示其已安装版本，且只要市场携带有
  更新的版本，就会显示“更新”按钮（更新还会先重新同步该市场，因此总是拉取
  真正的最新版本）。每张卡片的“安装”（或“作用域”）按钮会打开**范围弹窗**：
  单选钮选择插件的技能在哪里启用 —— **全局**（默认；技能落到本 DSH home
  处处扫描的共享技能根目录），或**选定的工作区**（显示已注册工作区的勾选
  清单；技能仍安装到共享根目录，范围只决定它们在哪些工作区中启用）。两种
  模式互斥 —— 一次安装，一个范围。对已安装的插件，卡片上还会提供“更新”和
  “卸载”——后者经两步确认弹窗移除插件——而范围弹窗中的“保存范围”会重新
  划定启用范围。
  技能全局安装，范围即启用；MCP 服务器、代理行、命令和钩子是插件级的，
  无论范围如何都只激活一次（弹窗中会说明这一点）。点击插件名称会打开**详情弹窗**：元数据、完整的组件清单（包括
  此桥接不安装的家族）、声明的依赖项，以及持久化在记录上的安装说明。
  范围特性引入之前的注册表记录（多目标或单范围形式）会在读取时迁移到
  范围结构：凡记录过全局根目录的即取全局（它覆盖所有工作区）；仅记录过
  工作区的记录则变为对这些路径的工作区范围。
- **安装插件** —— 每个插件的组件会落到原生消费它的 DSH 界面上：

  | Claude Code 组件 | DSH 目的地 | 激活时机 |
  | --- | --- | --- |
  | `skills/*/SKILL.md` | 共享技能根目录 `~/.agents/skills`（技能始终全局安装；范围仅控制启用） | 立即，通过文件系统提供者的 watcher |
  | `commands/*.md` | 通过内置运行时桥接接入 DSH 命令注册表（`ctx.commands`） | 立即；在每次安装/更新/卸载后重新注册。命令会把 `$ARGUMENTS` 展开到插件的模板中，并作为模型可见的用户轮次提交 |
  | `.mcp.json` 服务器 | `$DSH_HOME/cordis.patch.yml` 中受管理的 `dsh-mcp-client` 行 | 在 DSH 重启或 profile 重载之后 |
  | `agents/*.md` | 受管理的 `dsh-tool-subagent` 行（每个代理一个 `cc-agent-<name>` 委派工具，代理 markdown 作为子代理的角色设定；`tools:` frontmatter 转换为对翻译后的 DSH 工具名的 `toolFilter.allow` —— Claude 内置工具经由一张众所周知的映射表，`mcp__` 引用通过插件已安装的 MCP 行解析从而让服务器名称去重得以保留，外来的 `mcp__server__tool` 引用直接透传，因为 DSH 的 MCP 客户端使用与 Claude 完全相同的命名；映射到的 `model:` 变为 `agentOptions.model`） | 在 profile 重载之后 |
  | `hooks/hooks.json` | 运行时桥接以 Claude 兼容的 JSON stdin、`CLAUDE_PLUGIN_ROOT`/`CLAUDE_PLUGIN_DATA` 环境变量、加入 `PATH` 的插件 `bin/` 目录和逐钩子的超时运行每个匹配的钩子。`PreToolUse`/`PostToolUse` 挂接到 `tools/pre-execute`/`tools/post-execute`（退出码 2 或 JSON deny 会阻止调用）；`UserPromptSubmit` 挂接到 `agent/pre-step`（block 会拒绝该步骤，stdout 成为注入的上下文）；`SessionStart` 挂接到 `agent/session-start`（仅观察，stdout 被注入，matcher 选择 `startup`/`resume`/`clear`/`compact`）；`Stop` 挂接到 `agent/turn-stopping`（block 会引导代理继续，逐轮有循环防护）；`SubagentStop` 挂接到 `subagent/end`（仅观察） | 在 `runtime.hooks` 启用期间 |

- **更新安装** —— 从上游更新已安装的插件（技能在共享根目录中原地更新，
  被移除的技能可恢复地移入回收站，受管理的行以稳定的服务器/工具名重新
  渲染），从“作用域”弹窗重新划定范围（只改启用范围，不移动技能副本 ——
  且不触碰插件级的行），并卸载它（技能移到根目录的 `.trash`，受管理的行
  和物化的插件副本退出）。物化的插件副本在重写时**保留 `node_modules`**
  （与 Claude Code 跨插件版本的做法相同），因此其 MCP 服务器或钩子安装过
  依赖的插件在更新后依然可用；`package.json` 发生变化会被记录，以便插件
  自身的依赖引导程序刷新它们，而卸载会清除一切。安装与更新说明（未桥接的
  家族、被重命名的服务器、未解析的模板、依赖要求、技能 frontmatter 差异）
  会持久化在安装记录上：卡片带有一个“安装说明”角标，悬停即显示列表，
  详情弹窗则完整展示。

市场索引内的插件来源遵循 Claude Code 的 schema：相对路径（`"./plugins/foo"`、
`metadata.pluginRoot` 下的裸名称）、`{"source": "github", "repo": "owner/repo"}`、
GitHub `url` 来源，以及 `git-subdir` 来源（GitHub monorepo 的子目录 —— 官方
市场对其大多数插件使用的形式）。携带 `sha` 或 `ref` 固定的外部来源会精确安装
该提交。npm、archive 和 `command` 来源会被列为不可安装。

组件与版本的还原度遵循 Claude Code 当前的参考实现：

- **清单覆盖（Manifest overrides）** 可以是目录路径、单个文件路径，或两者
  混合的数组，适用于每个组件（`skills`、`commands`、`agents`、`hooks`、
  `mcpServers`）；多个 hooks 或 MCP 文件会合并（首个名称胜出，重复会被记录）。
- **`argument-hint`** 命令 frontmatter 会透传，作为 DSH 输入编辑器的提示。
- **MCP 模板展开** —— 服务器定义中的 `${CLAUDE_PLUGIN_ROOT}`、
  `${CLAUDE_PLUGIN_DATA}`、`${user_config.<key>}` 和 `${ENV_VAR}` 引用会在
  安装时针对插件的物化根目录、用户插件配置和宿主环境展开（DSH 的 MCP
  客户端不做任何替换）。用户插件配置来自组合中的 `runtime.userConfig`
  映射，可手工编辑的 `$DSH_HOME/cc-plugins/user-config.json` 会逐键覆盖 ——
  携带凭据的服务器（Grafana 类）引用的正是这种形式。`${CLAUDE_PROJECT_DIR}`
  按原样保留并附一条说明（它在各范围根目录之间没有单一取值），对未设置
  变量和未配置键的引用同样如此。stdio 行还会把插件根目录作为自己的
  `cwd` —— Claude Code 从插件根目录运行插件 MCP 服务器，相对命令路径
  （`./cli/server.js`）正依赖于此。
- **版本优先级** —— 目录侧依次取市场条目的 `version`，然后是插件自身
  `plugin.json` 的版本（对相对来源可解析），最后是完全无版本；无版本的插件
  从市场快照摘要获取更新信号（Claude 会把它们解析为来源的提交 SHA；摘要即
  本桥接在同机上的等价物，而且它还能捕获仅条目级的编辑）。
- **已识别但未桥接的家族** —— LSP 服务器（`.lsp.json` 或清单中的
  `lspServers`）、后台监视器、输出样式、主题、工作流以及插件
  `settings.json` 会被计数，并在卡片和详情弹窗中报告为“未桥接”，安装时
  也会注明；不会执行或安装来自它们的任何内容。插件的 `bin/` 可执行文件
  也会被计数，但并非完全未桥接：运行时桥接执行该插件的钩子命令时，该
  目录会加入 `PATH`，与 Claude Code 的做法一致。
- **插件依赖**（`plugin.json` 中的 `dependencies`）会像 Claude Code 一样
  从同一市场自动安装：本地缺失的每个被声明依赖都会随父插件一起安装并
  继承其范围，安装消息会报告每个结果。已安装的依赖（无论其范围）静默
  满足；索引中缺失的条目、超出声明范围（`name@^2.0.0`）的版本、自引用
  以及安装失败都会附注跳过，且绝不会让父安装失败。声明以 `requires:`
  的形式持久化在记录上；更新或卸载依赖保持显式且独立，与 Claude 一致。
- **技能 frontmatter** —— DSH 自身的技能运行时支持 `disable-model-invocation`
  和 `user-invocable`（同样的 kebab-case 名称），因此它们透传后仍可工作。
  `allowed-tools`、`disallowed-tools`、`model`、`effort`、`context`、`agent`、
  `background` 和技能级 `hooks` 没有 DSH 对应物，安装时会附带点名它们的说明。
- **非命令式钩子类型**（`http`、`mcp_tool`、`prompt`、`agent`）会按类型报告为
  不支持，而不是报告为解析错误。

## 配置

通过 schemastery 声明；profile 组合会将其作为该行的 `config`
传入（以下为默认值）：

```yaml
- id: dsh-next-cc-plugins
  name: '@dsh-next/dsh-next-cc-plugins'
  config:
    runtime:
      commands: true   # register slash commands from installed plugins
      agents: true     # emit agent delegation-tool rows on install
      hooks: false     # run hook commands (executes third-party shell)
      agentModelMap:   # Claude model id -> DSH model id for agents' model:
        sonnet: glm-4.7
      userConfig:      # ${user_config.<key>} values for MCP templates:
        grafana_url: https://grafana.example.com
```

`hooks` 默认为 false 是有意为之：钩子会执行来自已安装插件的任意 shell，且
生命周期事件（`UserPromptSubmit`、`SessionStart`）能看到你提交的每条提示。
在启用之前，请先审查插件的 `hooks/hooks.json` 会运行什么。

代理 frontmatter 转换说明：

- `tools:` 条目通过内置的 Claude 到 DSH 名称表映射（`Bash` -> `bash`、
  `WebSearch` -> `web_search`、`Task` -> `subagent` 等）。权限模式
  （`Bash(git log:*)`）只允许基础工具 —— 参数模式不会被强制执行。`mcp__` 引用
  通过插件已安装的 MCP 行解析（服务器归插件所有，因此名称去重得以保留），或对
  用户配置的服务器透传；只有确实没有 DSH 对应物的名称（例如 `NotebookEdit`）
  才会丢弃并附一条安装说明。
- `model:` 取值通过生效的模型映射解析：`runtime.agentModelMap` 是基线，而
  **“模型”标签页**在其上叠加已保存的覆盖（`$DSH_HOME/cc-plugins/model-map.json`）。
  该标签页从运行时的 `llm` 服务实时发现模型 —— 没有任何硬编码 —— 为你已安装
  代理实际引用的每个 Claude 家族、已映射别名和模型名称提供选择器，并把每个
  别名的默认值设为继承委派会话的模型；显式选择继承（保存为 `null`）会抑制
  该别名的配置基线值。保存时无需重新安装即可重新解析已安装的代理行（重载
  profile 后生效）。`model: inherit` 和未映射的取值会让子代理沿用委派父级的
  模型 —— 这是 DSH 的默认行为 —— 未映射的名称会附一条安装说明。Claude 模型
  id 从不原样透传：未知 id 会在创建子代理时让每次委派失败。
- Claude 的逐代理 `description` / `when_to_use`（父级侧的工具选择指引）目前
  在 `dsh-tool-subagent` 中没有对应物；父级通过其 `cc-agent-<name>` 名称挑选
  工具。
- `PreCompact`、`Notification` 和 `SessionEnd` 钩子事件没有忠实的 DSH 事件
  对应，仍会报告为不支持（压缩之后会表现为来源为 `compact` 的 `SessionStart`）。

## 市场还原度说明

- 市场描述从顶层或 `metadata.description` 读取（后者是某些市场使用的嵌套
  形式，例如 `holistics/skills`）。
- 根来源插件（`"source": "./"` —— 市场仓库本身就是插件，例如
  `ChromeDevTools/chrome-devtools-mcp`）会把整个快照安装为该插件。
- MCP 服务器可以声明在 `.mcp.json` 文件中，或内联在
  `.claude-plugin/plugin.json` 的 `mcpServers` 下（ChromeDevTools 的形式）；
  两者同时存在时以文件为准。
- 引用**插件级目录**（`references/`、`assets/` 等 —— 位于 `skills/` 旁边而非
  技能内部的文件）的技能保持与 Claude Code 一致的行为：在安装/更新时，凡
  能被证明在插件内解析的引用都会被改写（仅改写已安装的技能副本）为指向
  物化插件副本（`$DSH_HOME/cc-plugins/plugins/` 下）的绝对路径 —— `../`
  链按文件相对方式解析（与 Claude 的语义一致），裸 `dir/...` 形式按插件
  根目录相对方式解析，两者都经过针对插件文件映射的存在性检查，因此 URL、
  散文、未知路径和技能内部相对引用都保持字节不变。物化副本本身以及供给
  运行时桥接的缓存文件保持原样；安装说明会报告改写情况，而无处可解析的
  引用保持原样并附带一条点明确切可读位置的说明。
- 技能可能假定存在插件自身并未附带的 MCP 服务器（没有 `.mcp.json`，只有类似
  "set up the Holistics MCP" 的文字说明）。这种情况下不会有任何自动配置
  —— 请自行添加服务器（通过本插件的受管理 MCP 行或 profile 组合）。
- 存在于市场仓库中但未列入其索引的插件（例如共享库 `plugins/<name>-common`）
  会被正确地永不提供。

## 安全说明

- 技能和组合行落在用户所有的文件中；除非你安装的插件的 MCP 服务器或钩子
  定义了命令，否则不会运行任何可执行内容 —— 那些是第三方代码，与在 Claude
  Code 或 Grok 中一样。
- `cordis.patch.yml` 内的受管理块由 `# BEGIN/END dsh-next-cc-plugins` 标记
  分隔；该文件中的所有其他内容都会原样保留（该文件从不会被解析为 YAML，因为
  加载器方言包含 `!!js`）。
- 技能名称冲突会原子地中止安装；MCP 服务器名称和代理工具名称会跨插件去重，
  并在更新之间保持稳定。

## 可共享的设置镜像

市场、已安装的插件（连同其范围）和模型映射会被镜像到 DSH 用户设置文档
（`$DSH_HOME/settings.yaml`，即“模型”页面存储模型提供者的同一文件）中的一个
`cc-plugins` 小节：

```yaml
cc-plugins:
  marketplaces:
    - holistics/skills
  installs:
    - marketplace: holistics/skills
      plugin: holistics-reporting
    - marketplace: holistics/skills
      plugin: workspace-reporting
      workspaces:
        - web
        - data
  models:
    haiku: deepseek-v4-flash
    sonnet: inherit
```

不带 `workspaces` 的安装即全局。工作区范围只携带文件夹名称 —— 绝对路径在每台
机器上都不同。导入时，每个名称会对照该机器的工作区注册表解析（文件夹匹配的
已注册工作区；含糊或未知的名称会跳过并留一条日志说明），手写的绝对路径在
本地存在时仍然有效。工作区导入为全有或全无：插件清单上有一个名称无法解析，
整个插件就会跳过，而不是悄悄改变它的范围 —— 其余内容照常导入，并且“插件”
标签页会显示哪些导入被跳过及原因（`cc-import-skipped`），因此缺失的部分会
通过范围弹窗有意地安装，而不是靠猜。旧版本写入的文档（安装携带
`workspace:web` 之类的 `targets` 列表）也能导入：凡含 `global` 条目即视为
全局，否则工作区名称即成为范围。

面板的每次变更都会写入该小节（安装只记录存在性和范围 —— 版本跟随上游）。
在启动时，以及每当该文档在磁盘上发生变化（设置提供者会热发布外部编辑），
插件都会采纳文档携带而本机缺失的内容：缺失的市场会被添加，缺失的插件会
安装到其记录的范围中，模型映射在本机未保存任何映射时被采纳。移除从不会被
推断 —— 卸载始终通过面板显式进行。因此共享同一份 `settings.yaml` 即可在
全新机器上尽力复现整套配置，并有日志记录。

## 设置界面

浏览器侧注册一个顶层设置小节（“Claude 插件”），含三个标签页：**插件**（以
卡片网格展示每个市场的全部插件，带搜索、市场过滤器和“仅已安装”开关；每张
卡片显示已安装版本和“更新”按钮；记录携带说明时有安装说明角标；插件名称打开
含元数据、完整组件清单、依赖项和说明的详情弹窗；安装/作用域打开范围弹窗 ——
全局或工作区的单选钮，附工作区勾选清单）、**市场**（添加/刷新/移除来源，
并显示各来源上次同步的时间；超过 24 小时的快照在面板打开时重新同步）和
**模型**（把 Claude 模型名映射到此运行时提供的模型上，实时发现 —— 未映射
的名称继承会话的模型）。

面板通过平台 `locale` 服务遵循 DSH 的区域设置（English / 简体中文）—— 字典
位于客户端 bundle 的 `cc-plugins` 命名空间下，小节标签会在切换语言时重新解析。
宿主侧生成的消息（安装说明、错误）保持英文：它们持久化在安装记录上，并被
引用于诊断信息中。

## 安装

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-next-cc-plugins
```

## 开发

```sh
pnpm build
pnpm typecheck
pnpm test
```

完整的贡献流程与推送前检查门槛请参见仓库根目录。
