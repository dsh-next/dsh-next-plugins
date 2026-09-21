# Lazy history and concurrent repository reads

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-git

The panel controller now treats visibility as the loading seam. It does not fetch
commit history on panel startup while History is folded, does not refresh a
previously loaded log after that accordion closes, and does not refresh it behind
the file-diff view. Opening or reopening History loads a fresh bounded window;
returning from a diff also reloads History when its accordion remains open.
Writes use the controller's single visible-data refresh path, removing four
second history reads that followed worktree merge, operation continue, update,
and commit checkout.

Repository state assembly keeps the same `PanelState` contract while independent
reads run together. Operation markers, refs, default/primary branch discovery,
and identity now share one concurrent phase. Branches and tags have one private
`readRefs` module reused by panel state and `refSummary`; `refSummary` also reads
HEAD, its symbolic branch, and refs concurrently. Worktree cleanliness and its
three base-comparison facts run concurrently per worktree, while worktrees remain
sequential to avoid unbounded process fan-out. Identity name and email are read
together.

Controller tests pin the demand-loading rules, one refresh per visible write,
hidden-history suppression, and the diff-to-history transition. Existing host
contract tests continue to cover the unchanged repository-state and ref-summary
envelopes. The Git browser suite counts RPC methods: it observes zero history
reads through startup and the preceding repository interactions, then observes
the first history read after the accordion opens.
