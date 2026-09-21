# Ref quick pick for branches, remotes and tags

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-git

The header's branch chip no longer opens a dropdown menu. It opens a search field
over grouped rows — the VS Code branch-quick-pick shape the request named: the
quick actions `Create new branch…`, `Create new branch from…` and
`Checkout detached…` on top, then `branches`, `remotes` and `tags` sections whose
first row carries the section name on the right, and two lines per row (the name
with its drift and age, then the tip commit's author, short hash and subject).

## Data

One `for-each-ref` read now carries what the rows show. `BRANCH_FORMAT` gained
`%(authorname)`, `%(committerdate:unix)`, `%(upstream:track)` and `%(subject)`
(subject last, so a subject containing the field separator still parses), and the
branch read sorts by `-committerdate`. `TagInfo` replaces the bare tag-name list,
with `%(*objectname)` so an annotated tag resolves to its commit — the id a
detached checkout names. `parseTrack` reads `[ahead n, behind m]`, `[gone]` and
empty alike. Subjects are bounded at 200 characters so the state envelope stays
bounded; a missing or unusable time parses as 0 and the row simply shows no age.

`core/refs.ts` is the picker's one model: `RefOption` (kind, name, the local name
a remote checkout creates, oid, tip detail, drift, whether it is the current
checkout) and pure `partitionRefs` / `filterRefs` / `hasLocalBranch`. Filtering
ranks a name prefix above a substring, above an ordered subsequence, above a
subject/author/hash hit, and keeps source order within a rank.

## Behaviour

- A remote-tracking row whose local twin is the checked-out branch wears the
  current marker; picking it closes rather than asking git to create a branch
  that exists. A remote row without a twin checks out a tracking branch. When a
  local twin exists but is not active, the panel switches to the twin.
- A tag cannot be a branch, so picking one detaches (after the existing
  confirmation). The detached list is a step inside the same card, and it is
  also where the repository's `Checkout…` command routes — that command was
  reachable only from the removed tabbed modal, so `LocalCommandDialog` no
  longer owns a checkout form.
- Creating is a two-step pick in the same card: base (a ref, or HEAD) then name,
  validated with `validateBranchName` plus an existence check, with the host's
  refusal shown in place instead of closing. A created branch is checked out,
  which is what the action says it does.
- The worktree start-point button reuses the same picker, so a branch reads the
  same wherever it is picked; its `New branch from <base>` row stays in the
  action slot.

## Header row

The repository-actions menu moved to the end of the header row: the one-click
shortcuts (new worktree, agent verbs, Refresh) come first and the catch-all
menu closes the row, which is where a command you cannot see belongs. A DOM
order test pins it, including that nothing trails it.

## Composer chip

The same picker is offered where a session starts. DSH 0.1.6-alpha.2 renders the
hero's workspace row from two occupied `single` seats (`conversation.hero.workspace`,
`conversation.hero.agentPreset`) plus a directly rendered workspace chip, so no
third party can add a control to that row; the nearest seat a plugin can own is
`conversation.input.left`, the composer tool row's list, which renders in the
hero as soon as a workspace is chosen and in every live session. That is where
`BranchChip` registers, matching its neighbours' geometry (28px, 13px/500).

It reads `refSummary` — a new, smaller RPC: root, head, branches, tags, with the
drift taken from the current branch's row so it costs no extra git process. Any
failure means "no repository here" and the chip renders nothing, except
`session-not-ready`, which is retried (a session the host has not loaded yet
resolves itself). Unknown branch names are never guessed into the UI: a
detached HEAD and an unborn repository reuse the panel's own labels.

On a narrow composer the chip drops its branch name and keeps the glyph and
chevron, the way the access selector beside it does. The breakpoint is a
container query on the composer tool row (which already declares
`container-type: inline-size`) at 380px of *content* width, tighter than that
selector's 460px on purpose: the tool row's content box is ~454px at the
standard desktop card width, so 460 would collapse this chip everywhere, while
a branch name is short enough to earn its place until the composer is genuinely
phone-narrow. The visible label disappears, so the branch name is also the
button's `aria-label` and survives the collapse.

Switching from the chip goes straight to the host instead of asking a
confirmation: the chip reads no status, git refuses a switch it cannot carry,
and the refusal is shown inside the card. Creating is create-then-checkout, as
the quick action says.

## Evidence

`tests/refs.spec.ts` pins option mapping, grouping, ranking and the twin-current
rule; `tests/branches.spec.ts` pins the new parsing (track, bounded subject,
peeled tags, unusable times); `tests/branch-picker.spec.tsx` renders the real
card and covers the quick actions, the filter and its create row, arrow/Home/End
and Enter activation, pointer hover, both create paths (including the inline
refusal), the detach step and the age wording; `tests/client-panel.spec.tsx`
covers the chip opening the picker, switching, the dirty-tree confirmation, and
creating-and-checking-out through the real store. `tests/branch-chip.spec.tsx`
covers the composer chip: hidden without a repository (and for a bare one, no
git, no permission), the not-ready retry, the focus re-read, switch/create/
detach through the real card, a refused switch kept in the card, and a read
that lands after unmount. `tests/git-service.spec.ts` and `tests/rpc.spec.ts`
pin the new read and its envelope. The Git browser suite drives
the picker in the shell (filter, create row, create step, current-branch no-op)
and records `media/branch-picker.webp`. READMEs document the picker in both
languages.
