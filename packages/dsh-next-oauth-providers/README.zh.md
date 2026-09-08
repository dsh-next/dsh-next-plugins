# oauth-providers

[English](README.md) | 中文

这是一个 DeepSeek Harness 插件，在 **设置 → 模型** 下方增加 **订阅**。
使用 Kimi、Grok、ChatGPT 或 Claude 的编程订阅登录，流程与 API 密钥行相同：
**添加提供方** / **编辑** / **删除**。已连接的模型会出现在现有的模型选择器中。

## 如何使用

1. 打开 **设置** → **模型**。
2. 滚动到 **订阅**。
3. 点击 **添加提供方**，选择 Kimi Code、Grok、ChatGPT 或 Claude，然后
   **登录** 并完成浏览器或设备码流程。**保存** 会写入该行。
4. 之后可用 **编辑** 打开同一张卡片。**获取可用模型** 会打开与官方相同的选择器，
   可勾选或取消模型 ID。**恢复默认模型** 会清除自定义目录。
5. **删除** 会移除登录以及本页保存的模型目录。

## 功能

### 无需 API 密钥即可登录

编辑卡片保持官方布局。API 密钥行上的密钥输入，在这里换成 **登录** / **重新登录**。
令牌保存在 `$DSH_HOME/.credentials.yaml` 的 `dsh-next-oauth-providers` 范围下，
而不是 `settings.yaml`。

### 模型目录

省略模型列表或使用空列表时采用适配器默认值，非空列表会替换目录。
`Fetch available models` 需要先登录，只有在选中模型并点击 `Apply` 后才会写入。
Kimi、ChatGPT 和 Claude 使用随插件附带的目录。Grok 会先请求编程端点，
若请求失败或超过 30 秒，则回退到随插件附带的目录。

### Grok 编程端点

Grok 流量走 Grok 编程代理，而不是普通的 xAI API 端点。

## 安装

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-oauth-providers
```

`<name>` 是你的 DSH profile（例如 `web`）。

## 使用前须知

- 需要 DeepSeek Harness `0.1.3-alpha.2` 或更新版本（官方 `dsh-llm-pi-ai`）。
- 模型目录写在 `dsh-next-oauth-providers.providers` 下，为官方目录 id 的块状列表
  （`xai`、`kimi-coding`、`openai-codex`、`anthropic`）：

  ```yaml
  dsh-next-oauth-providers:
    providers:
      - id: xai
        displayName: Grok
        models:
          - id: grok-4.6
            name: Grok 4.6
            contextWindow: 500000
            maxTokens: 500000
  ```

  选择器使用同一 id 加 `-oauth` 后缀（`xai-oauth` 等），因此 API 密钥行
  `anthropic` 可以与 Claude 订阅并存。不能写进 `llm-pi-ai:`：该段只接受
  API 密钥 `providers`。
- ChatGPT OAuth 仍用 pi-ai 模型列表，但默认上下文 / 最大输出采用官方 API
  数值（当前 GPT-5.4+ 为 1050K / 128K；`gpt-5.4-mini` 为 400K / 128K）。
  自定义设置仍可覆盖单行。
- 此版本每个产品系列只能有一个账号。重新登录会替换该授权。
- 关闭编辑器、切换提供方编辑器或离开模型页面，会取消尚未完成的登录。
  取消正在等待凭据写入的登录时，会保留之前保存的授权。
- 订阅是否可用由提供方控制。在这里登录并不会赠予你尚未拥有的套餐。
- Claude 与 ChatGPT 的回调服务绑定回环端口 `53692` 和 `1455`。若 1455
  已被占用（常见于 VS Code Codex），ChatGPT 登录会失败。
- 本包目前为 private，待真实提供方登录验证后再发布。
- 贡献者请看 [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md)。
