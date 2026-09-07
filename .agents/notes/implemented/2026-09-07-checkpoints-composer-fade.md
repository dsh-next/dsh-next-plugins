# checkpoints composer fade overlay

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

The Checkpoints tab hid the whole overlay composer seat (`visibility:
hidden` on `[data-composer-seat]`). That also hid ConversationRoot's
36px fade (`color-mix` of `--dsw-alias-bg-base` over 36px), so
`bg-layer-1` met the column `bg-base` as a hard edge. Trajectory keeps
the seat and the fade.

Checkpoints now sets `data-conversation-composer-overlay` on the view
(same contract as Trajectory), hides only the composer chrome, and
clears the rail/pane with `--dsh-composer-height + 16px` so rows can
scroll above the overlay. Width-handle hide stays as a belt-and-suspenders
rule; the overlay attribute already turns those handles off.
