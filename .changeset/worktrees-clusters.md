---
"@dsh-next/dsh-next-worktrees": minor
---

Worktrees are now named folders of chats nested under the repo.

The branch icon asks for a kebab-case folder name (`update-plugin`); Create stays off until the name is valid. That name is the sidebar title and the folder on disk. Git commands live on that folder menu; folder `+` starts another session on the same files. Session menus are stock again (`Rename` / `Fork` / `Archive`). `Delete worktree…` replaces stock `Delete workspace` on the folder.

Setup commands such as `pnpm install` start as soon as the folder exists and run isolated from the harbor's npm/pnpm workspace, so a nested worktree is not treated as a missing package.

Hovering a cluster swaps the branch icon for the expand chevron, same as a stock folder. Session titles line up with the cluster title.
