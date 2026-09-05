# Worktrees would-conflict hint uses session, not agent

- date: 2026-09-05
- status: implemented
- scope: packages/dsh-next-worktrees

`update.wouldConflict` now says "this session will resolve", matching
Resolve in this session / Open session. README still names the bound
session's agent where it explains who authors the commit.
