---
"@dsh-next/dsh-next-worktrees": minor
---

Initial release. Nested git worktrees in the DeepSeek Harness sidebar: isolate parallel agent sessions on one repository, optionally run setup from `.worktrees.json`, catch up with Update from the current branch, and land with a guarded one-click merge. When a merge would conflict, Resolve in this session lets the bound agent fix files in the worktree first; Abort merge undoes that in-progress merge without touching the main folder.
