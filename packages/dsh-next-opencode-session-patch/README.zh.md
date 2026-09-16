# dsh-next-opencode-session-patch

[English](README.md) | 中文

为 DSH 宿主进程发往 OpenCode Go 提供方（`https://opencode.ai/zen/go`）的每个请求附加 `x-opencode-session` 请求头，取值为当前 DSH 会话 id。

## 为什么需要

OpenCode Go 会拒绝缺少该请求头的请求（HTTP 400 `MissingSessionID`），而 pi-ai 与 DSH 的 llm-pi-ai 适配器都没有提供按请求注入请求头的接缝。本插件通过修补宿主进程的 `globalThis.fetch`，在需要时补上该请求头。

## 工作方式

- 修补是 effect 作用域的：卸载插件后恢复原始 `fetch`。
- 会话归属使用 DSH agent 注册表的 initiator 作用域，因此每个请求都会带上发起它的 agent 回合的会话 id。任何 agent 回合之外的调用共享稳定的回退 id `dsh`。
- 发往其他端点的请求原样通过，不做任何修改。
- 仅宿主侧：浏览器半区不做任何事情。

## 安装

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-opencode-session-patch
```

`<name>` 是你的 DSH profile（例如 `web`）。

## 使用前须知

- 贡献者请看 [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md)。
