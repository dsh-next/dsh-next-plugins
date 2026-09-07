# dsh-next-checkpoints idea refined and recorded

- date: 2026-09-06
- status: proposed
- scope: docs/ideas/dsh-next-checkpoints.md (future packages/dsh-next-checkpoints)

Refined concept for a checkpoints plugin recorded at
docs/ideas/dsh-next-checkpoints.md. Core model: in-place restore of files
and model history as one checkpoint; `Changes` conversation tab whose
rows are turn-boundary checkpoints; select a row to see cumulative file
diffs up to that moment; rewind control plus confirm modal actually
restores; package name `dsh-next-checkpoints`; slash command `/rewind`.

Locked after review: checkpoints are moments not edits; click inspects
and rewind+modal restores (select never restores); file truth is a
touched-path tree snapshot not reconstructed tool args; rewind is
in-place in the same session (fork is fallback only); worktrees are a
recommended pairing not a hard dependency; model-visible rewind is the
v1 must, Chat-tab disappearance is a should (banner is acceptable);
diffs are host-hunked `DiffBlock` (never whole files, never Monaco);
checkpoints are not git — commits during the session stay, rewind
restores files only and warns when HEAD moved; git-name discovery is
against session-start HEAD, not dirty `git status` (clean after
commit). M0 is a throwaway surface-replace probe before
`pnpm plugin:new`. Implementation has not started.
