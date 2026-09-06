# Worktrees create: spinner on the branch icon

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-worktrees

Create is modal-free and already wrote `html[data-dshx-creating]`, but
nothing consumed it, so a click looked stuck for the seconds `git
worktree add` (full checkout) and optional `.worktrees.json` setup
(`pnpm install` in this repo) actually take. The repo-row button now
spins from that dataset (CSS, no official-browser re-render); a polite
live region announces `Creating worktree…`. Host create also overlaps
the cheap git probes and runs `worktree add` with `checkout.workers=0`.
