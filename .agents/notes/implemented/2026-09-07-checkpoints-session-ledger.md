# Checkpoints session ledger (no git file list)

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

DSH core has no session file tracker: `ctx.fs` exposes write/edit intent and
`fs/observed` only — no delete, rename, copy, or watch. Deliverables and
agent-instructions also refuse to parse bash. Claude Code documents the same
gap (bash and external edits are not checkpointed).

Turn snapshots no longer union git dirty/untracked names (that mixed other
sessions in a shared cwd). The ledger is fs-tool intents plus prior checkpoint
trees. When a ledger path is missing, a bounded cwd walk matches content
hashes so `mv notes-kettle.txt random-files/` still shows the new path.
`capture()` (e2e) still seeds from git untracked/status. Git HEAD remains for
the moved-HEAD warning only.
