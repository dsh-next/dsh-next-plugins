# DeepSeek Harness 决策模型

[English](README.md) | 中文

配置从给定选项中作出选择的模型，例如将请求分给账单或技术支持部门，与聊天模型分开管理。

## 安装

**私有且尚未发布。** 需要 DeepSeek Harness `0.1.7-rc.1` 或更新版本。发布后可使用：

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-decisions
```

将 `<name>` 替换为你的 DSH 配置档案，例如 `web`。编辑需要使用本地 Web GUI，并有权保存该配置档案的设置。

## 快速开始

请先准备 TypeSafe API 密钥，以及提供商给出的准确模型 ID。

1. 打开 `Settings` → `Models` → `Decision models`。
2. 选择 `Add decision model provider` → `TypeSafe`，输入 API 密钥。
3. 在 `Models` 下输入模型 ID，选择 `Save`。页面会显示提供商卡片；保存时不会联系提供商。
4. 如需检查连接，打开 `Models and test` 并选择 `Model to test`。**`Test decision` 会向提供商发送示例，可能产生费用。** 点击后可查看响应；成功仅说明连接和响应格式通过检查，不代表决策准确。

## 你可以做什么

- **分开管理决策模型：** 它们不会出现在聊天模型选择器中。
- **管理提供商：** 编辑模型 ID 和名称，或删除提供商及其已保存的密钥。
- **使用自定义端点：** 对兼容 System One 的服务选择 `Custom decision API`，普通聊天 API 不适用。

![Models 设置中的决策提供商卡片](<media/provider-cards.webp>)

## 使用须知

- 本插件为其他插件提供决策服务，不会自行添加聊天工具、执行操作或连接 Squads。
- 模型 ID 需要手动输入。不提供自动发现或本地模型安装功能。
- 密钥保存在 Harness 的凭据存储中。已保存密钥不代表它一定可用。
- 仅支持文本/JSON 输入和选择题。取消测试不能保证提供商停止处理或不收取费用。

[提供商设置与开发接口](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/decisions.md>) · [获取帮助](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [参与贡献](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
