# Checkpoints for DeepSeek Harness

English | [中文](README.zh.md)

Review an agent's file changes and return both files and conversation to an earlier point in your session.

## Install

Requires DeepSeek Harness `0.1.2-rc.1` or newer.

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-checkpoints
```

Replace `<name>` with the DSH profile you use, for example `web`. Reload that profile after installation.

## Quick start

1. In a project session, ask the agent to make a small file edit and wait for the turn to finish. Checkpoints are saved at session start and after each turn.
2. Open `Checkpoints` beside `Chat` and `Trajectory`. The newest checkpoint is at the top.
3. Select a checkpoint, then a file, to see its changes. Selecting a row does not restore anything.
4. To go back, choose `Rewind`. **Restoring can overwrite files and remove later file changes.** Read the warnings before confirming. Harness opens a conversation ending at that checkpoint and archives the previous session.

To undo the first turn too, choose `Session start`. A checkpoint after turn 1 keeps that turn's changes.

## What you can do

- **Review changes:** see files created, changed, or deleted up to a checkpoint, compared with session start.
- **Inspect a file:** view added and removed lines before deciding whether to restore.
- **Return to earlier work:** restore the saved files and stop sending later conversation messages to the model.

![Changed project files beside checkpoints for session start and two turns](<media/checkpoints.webp>)

## Good to know

- This is not a full-folder backup. It tracks this session's file work, not everything changed by other sessions or tools.
- Rewind does not undo Git commits. Restored files may appear as uncommitted changes in Git.
- You cannot rewind while an agent turn is running. Warnings also flag other edits that could be overwritten and Git history that has moved.

[Rewind details and limitations](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/checkpoints.md>) · [Get help](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [Contributing](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
