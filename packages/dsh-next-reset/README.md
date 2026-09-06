# reset

English | [中文](README.zh.md)

This DeepSeek Harness plugin starts a **blank session in the same folder**
and archives the chat you were in. Type `/reset` when the transcript is
polluted and you want to keep working here — including inside a plugin
worktree or a folder created with `git worktree add`.

The switch *is* the acknowledgement. You will not see a “Reset succeeded”
line; that string is written on the old log, which the sidebar no longer
shows.

## How to use it

1. Wait until the agent is idle (no running turn, no queued prompt).
2. Type `/reset` in the composer and send it.
3. The chat goes blank. The sidebar row keeps the old title. You are still
   in the same folder.

## Features

### Same folder, new chat

The new session uses this workspace’s directory. A `git worktree add`
checkout stays that checkout. Unsaved composer draft is discarded.

### Worktrees stay claimed

If `dsh-next-worktrees` is mounted and this session owns a plugin worktree
(`/.dsh/worktrees/<slug>`), `/reset` hands that claim to the new session
and keeps `danger-full-access` so git still works. Ordinary folders and
CLI worktrees skip that step.

### One-way archive

The old session’s JSONL stays on disk. DeepSeek Harness has no unarchive
UI, so the sidebar will not offer the old chat back.

## Install

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-reset
```

`<name>` is your DSH profile (for example `web`). Reload the profile after
adding the plugin.

## Good to know

- Requires DeepSeek Harness **0.1.2-rc.1** or newer and the **web UI**.
  ACP and headless sessions get an error instead of minting an orphan
  blank.
- The command is `/reset`, not `/clear`. A future core `/clear` would
  mean “forget in this log,” which this plugin does not do.
- `/reset` on an already-blank session is a no-op.
- It refuses a running agent, a queued prompt, a subagent session, and a
  session with no working directory.
- The new row keeps the old topic name (the title is pinned). `/goal` is
  not copied.
- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
