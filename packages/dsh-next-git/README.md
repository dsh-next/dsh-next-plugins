# Source control for DeepSeek Harness

English | [中文](README.zh.md)

Review changes, save commits, and work on branches without leaving Harness.

## Install

- Requires Harness 0.1.7-alpha.1 or newer, Git 2.31+, and a session in a Git repository.
  Configure your Git commit name and email before committing.
- **Not released:** this package is private and not currently published to npm.
  The command below is for a future release.

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-git
```

`<name>` is your DSH profile (for example `web`).

## Quick start

1. Open a session in your repository. In the right sidebar's `Start guide`
   (compass tab), choose `Source control`.
2. Check the branch name in the header. Edit and save a file in that folder,
   then expand `Changes`.
3. Click a changed file to review it. Hover its row and choose `Stage` to
   select its changes for a commit.
4. Choose `Commit`. Enter a summary in `Commit message`, with optional details
   after a blank line, then press `Cmd`/`Ctrl` + `Enter`.
5. Open `History` to see your new commit. It is saved locally, not pushed.

## What you can do

- Review file diffs and stage whole files or individual hunks (groups of changed lines).
- Choose branches from the sidebar or message composer before starting work.
- Create worktrees—separate working folders—for another branch or session.
- Inspect and compare commits, or resolve conflicts with a dedicated editor.
- Ask the agent to review changes or draft commit messages.

![Changes section showing unstaged and untracked files](media/changes.webp)

## Good to know

- `Discard` cannot be undone; it deletes untracked files. Deleting a worktree
  removes its folder. Review confirmations and back up important work.
- History rewrites change commit IDs and remove old signatures. Shared-history
  rewrites need acknowledgment; nothing is pushed automatically.
- AI actions send code to the selected model provider and may incur charges.
  Review shared files; sensitive-filename filtering does not catch every secret.
  Sparkle drafting sends diffs directly and replaces the message on success.
- Worktree setup runs project commands with your account and may copy local
  files. Both require approval for each creation; neither happens automatically.

Read the [worktree setup, history safety, and troubleshooting guide](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/git.md>)
for advanced tasks, or the [contributor guide](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
for local development.
