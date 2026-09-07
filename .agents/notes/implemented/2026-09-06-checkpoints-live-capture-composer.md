# checkpoints live capture and Changes chrome

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-checkpoints

Live session had checkpoints with empty trees: `intentKeys` never filled
because `fs/write-intent` / `tools/execute` were not `{ global: true }`, so
they never saw tool-fs's waterfall. The workspace was also not a git repo, so
git-name discovery could not compensate. Listeners are now global; write/edit
tools also snapshot `file_path` at `tools/execute` before `next()`.

Trajectory does not replace ConversationRoot: it fills `conversation.view`
(`width/height: 100%`, `overflow: hidden`, `bg-layer-1`) and leaves the overlay
composer mounted so `:has([data-conversation-composer-overlay])` keeps Chat
column width handles `display: none`. Hiding the composer with `display: none`
dropped that :has() and the drag line came back. Changes now matches
Trajectory's view fill and uses `visibility: hidden` (plus an explicit
width-handle hide) so the composer and resize line are gone without breaking
the shell's overlay contract. The checkpoint rail no longer clips `Rewind`.
