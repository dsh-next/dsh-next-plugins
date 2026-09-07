# Checkpoints live in-progress turn

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

While a turn is open the host keeps an in-memory live checkpoint
(`${sessionId}:live:${turn}`), refreshed at most every 400ms (and immediately
after an fs intent). `list`/`diffs` expose it; it is not persisted and is
replaced by the committed turn/end snapshot. Rewind of the live id is
turn-open.

The Checkpoints rail replaces that row's Rewind control with the shell spinner
(business-primary on border-l2, 12px). The client polls every 500ms while
`openTurn`, follows a newly appeared live id, and refetches diffs when the live
timestamp moves so the file list and Files-header +/− totals update in place.

Dictionary: `row.inProgress`, `row.inProgressAria`.
