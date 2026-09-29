# DeepSeek Harness 检查点

[English](README.md) | 中文

查看 agent 对文件的改动，并将文件和对话一起恢复到会话中的较早时刻。

## 安装

需要 DeepSeek Harness `0.1.2-rc.1` 或更新版本。

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-checkpoints
```

将 `<name>` 替换为你使用的 DSH 配置档案，例如 `web`。安装后重新加载该配置档案。

## 快速开始

1. 在项目会话中，请 agent 对文件做一个小改动，并等待该轮结束。插件会在会话开始和每轮结束时保存检查点。
2. 打开 `Chat` 和 `Trajectory` 旁的 `Checkpoints`。最新的检查点位于顶部。
3. 选择检查点，再选择文件，查看改动。仅选择一行不会恢复任何内容。
4. 如需回退，选择 `Rewind`。**恢复可能覆盖文件，并移除之后的文件改动。** 确认前请阅读警告。Harness 会打开截止到该检查点的对话，并归档原会话。

如果连第一轮的改动也要撤销，请选择 `Session start`。第一轮结束后的检查点会保留该轮改动。

## 你可以做什么

- **查看改动：** 查看从会话开始到所选检查点之间新增、修改或删除的文件。
- **检查文件：** 先查看增加和删除的行，再决定是否恢复。
- **返回较早状态：** 恢复保存的文件，并停止向模型发送之后的对话消息。

![项目文件改动，以及会话开始和两轮结束时的检查点](<media/checkpoints.webp>)

## 使用须知

- 这不是整个文件夹的备份。它跟踪本会话的文件操作，而非其他会话或工具造成的所有改动。
- 回退不会撤销 Git 提交。恢复后的文件可能在 Git 中显示为未提交的改动。
- agent 回合进行中不能回退。若其他编辑可能被覆盖，或 Git 历史已发生变化，也会显示警告。

[回退详情与限制](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/checkpoints.md>) · [获取帮助](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [参与贡献](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
