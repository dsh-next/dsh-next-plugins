# DeepSeek Harness 技能

[English](README.md) | 中文

无需离开 Harness，即可从 GitHub 浏览并安装可重复使用的 agent 指令，也就是技能。

## 安装

需要 DeepSeek Harness `0.1.7-alpha.1` 或更新版本。

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-skills
```

将 `<name>` 替换为你的 DSH 配置档案，例如 `web`，并打开该配置档案的 Web GUI。

## 快速开始

1. 打开 `Settings` → `Skills`，等待默认目录加载。
2. 搜索技能。安装前点击名称阅读指令，并选择你信任的来源。
3. 点击 `Install`。技能将供各工作区使用，但仍遵循自身的调用设置，而非只在当前项目中生效。
4. 如需检查更新，打开 `Providers` 并选择 `Refresh all`。这只检查目录，不替换现有副本。**选择 `Update` 前请备份本地修改：更新可能永久移除这些内容。**

## 你可以做什么

- **查找技能：** 搜索目录，按提供方筛选，或使用 `Installed only` 只看已安装技能。
- **添加来源：** 打开 `Providers` 并添加公开 GitHub 仓库，例如 `owner/repo`。
- **管理已安装副本：** 更新技能、切换来源，或选择 `Local (hand-managed)` 停止提供方更新。
- **阅读和打开文件：** 查看技能指令，并在支持的应用可用时打开其文件夹。

![包含可搜索技能卡片和提供方控件的 Skills 设置](<media/skills.webp>)

## 使用须知

- 安装为全局安装，通常位于 `~/.agents/skills`。此页面不管理项目技能，也不提供按工作区启用的开关。
- 从旧版作用域控件升级后，之前停用或受限的全局技能将全局可用。技能自身的调用设置仍然有效。
- 更新和切换来源会覆盖副本，也会移除本地新增文件，且无法从回收站恢复。`Delete` 则会把副本移到其技能根目录下的 `.trash` 文件夹。
- 手动删除已安装文件后，刷新可能重新安装它们。请使用界面的 `Delete` 移除安装记录。
- 打开文件夹的应用运行在 Harness 所在机器上，可能不是浏览器所在的机器。

[来源、更新与恢复](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/skills.md>) · [获取帮助](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [参与贡献](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
