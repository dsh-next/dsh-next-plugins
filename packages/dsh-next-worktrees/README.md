# worktrees

English | [中文](README.zh.md)

This DeepSeek Harness plugin lets two agents work on the same git repository
without overwriting each other. Each session gets its own folder and branch.
When the work is ready, `Merge…` copies those commits onto the branch you
have checked out in the main folder. If the branches would conflict, choose
`Resolve in this session` so this session's agent can fix the files first.

![Create a worktree, work in that session, merge, then clean up](media/loop.webp)

## How it works

1. In the sidebar, on the row for your git repo, click the branch icon
   (next to `+`). Name the folder. A worktree opens as a nested cluster
   under that repo, with one session inside it.
2. Do the work in that session. The cluster `+` starts another chat on
   the same files. The main folder stays on its own branch.
3. When you are ready, open `Merge…` on the cluster `...` menu. The plugin
   checks first. If the branches would conflict, choose
   `Resolve in this session` — this session resolves the files and commits.
   Then Merge is a fast-forward.
4. Keep the worktree or remove it. The branch and the chats stay either way.

![Worktree sessions nested under the harbor repository](media/sidebar.webp)

## Features

### Create

The branch icon opens a name field (a suggestion is filled in). Use
lowercase letters, numbers, and hyphens (`update-plugin`). That name is
the sidebar title and the folder on disk. Create stays off until the
name is valid. The cluster appears under the repo; if the project has
setup commands, that row's branch icon spins until they finish.

![Repository row with the worktree create button](media/create.webp)

### Find a session

Use `Search sessions` in the sidebar and select a result. Search closes and
scrolls to that session. For a worktree session, its repository and cluster
open automatically, including sessions hidden by the collapsed list. This
also works in the `In one list` view.

### Status

The branch icon is the status: gray when clean, amber with uncommitted
changes, blue when this branch is ahead (with the commit count), green
when already merged, red when a merge is in progress.

![Five worktree rows showing clean, uncommitted, ahead, merged, and conflict icons](media/status.webp)

### Cluster menu

The folder `...` menu keeps stock `Rename`, then adds `Refresh` (re-read
git status), `Update from <branch>…` (bring that branch into this
worktree), `Merge…`, and `Delete worktree…` (this replaces stock
`Delete workspace`). Session `...` menus stay stock
(`Rename` / `Fork` / `Archive`). The folder `+` starts another session
in the same worktree.

![Session menu with Refresh, Update from main, Merge, and Delete worktree](media/menu.webp)

### Hover details

Hover the cluster for its title, branch, status, and
`N sessions, same files`.

![Hover card with branch and ahead status](media/hover.webp)

### Merge and conflicts

`Merge…` checks that the merge would succeed, then lands the worktree on
your current branch. Uncommitted files are listed; you can still Merge.
Git will refuse if the main folder's files would be overwritten.
Uncommitted worktree files are not included. If the branches would
conflict, the next step is `Resolve in this session`: the plugin merges
the main branch *into the worktree* (never the other way), this session
fixes the files, and you Merge as a fast-forward. While a merge is in
progress the dialog offers `Abort merge`. Closing it leaves the merge in
the worktree; the main folder is untouched.

![Conflict, resolve, in-progress, and landed merge dialogs](media/merge-flow.webp)

### Delete

Removes the extra folder. The branch and session log stay. A worktree
with uncommitted changes needs a second confirm (`Remove anyway`).
The next Create suggests an available name, adding a number when needed
(`nimble-falcon-2`). Suggestions avoid existing folders and retained
worktree branches. A name you type yourself must still be available.

![Delete worktree dialog warning about uncommitted changes](media/delete.webp)

### Unused worktrees

A worktree you never started is removed when you switch to another
session. A worktree with uncommitted changes is never removed this way.
If you archive every chat in a named cluster, the folder stays so you
can open another session with `+`.

## Optional local files

A new worktree is a clean git checkout. Files git does not track stay in
the main folder — `.env`, `.env.local`, and other local secrets. The new
session would otherwise start without them.

Commit a `.worktreeinclude` at the repo root when those files must exist
in every new worktree. One relative path per line (`#` starts a comment).
On create, each listed file is copied from the main folder into the new
folder.

```
.env
.env.local
```

Use it when:

- The app or the session needs a local file git ignores (typical: `.env`)
- Every new worktree should get the same copy from the main folder
- You can commit the list of paths (not the secret files)

Skip it when:

- You have no gitignored local files
- What is missing is installed or generated (`node_modules`, `lib/`) — that belongs in setup commands
- Each worktree should get its own file that you create by hand

Missing sources are skipped. It only copies files, not whole folders, and
it does not run install commands.

![Example .worktreeinclude listing .env and .env.local](media/worktreeinclude.webp)

## Setup commands (optional)

Clicking the branch icon to create a worktree already runs setup when
`.worktrees.json` is at the repo root (or `.dsh/worktrees.json` as a local
override). The new session row appears first; setup then runs with that
row's branch icon spinning. You do not click anything else.
`$ROOT_WORKTREE_PATH` is the main folder. A failed command leaves the
worktree and session; the error shows the command output so you can run
setup yourself or delete the worktree.
Gitignored writes (`.env`, `node_modules`) do not count as uncommitted
changes. A file git can see (not ignored) does: Update waits until you
commit or delete it; Merge lists it and still runs.

Use this for commands (`pnpm install`). Setup runs in the new folder
with the harbor's npm/pnpm workspace env stripped, so a nested worktree
is not treated as a missing workspace package. Use `.worktreeinclude` to
copy local files such as `.env`.

```json
{
  "setup-worktree": [
    "pnpm install"
  ]
}
```

That `setup-worktree` list is enough. `setup-worktree-unix` and
`setup-worktree-windows` are optional, only when the commands differ by OS.
A string value is a script path relative to the JSON file. `.dsh/worktrees.json`
wins when both files exist.

## Install

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-worktrees
```

`<name>` is your DSH profile (for example `web`).

## Good to know

- Needs DeepSeek Harness `0.1.2-rc.1` or newer.
- Do not install alongside another plugin that replaces the sidebar.
- The plugin never writes commit messages. This session's agent does.
- Contributors: see [CONTRIBUTING.md](https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md).
