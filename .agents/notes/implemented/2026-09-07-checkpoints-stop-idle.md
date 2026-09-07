# Checkpoints Stop clears the live turn

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

Clicking Stop can leave the agent idle without a `turn/end` the plugin
already observed. `openTurn` stayed set, the rail spinner kept spinning, and
Rewind refused with "A turn is still running."

`agent/status` idle now finishes the open turn (commit the live snapshot, drop
the in-memory live row). A later `turn/end` does not commit a second row.
`turn/end` without `data.turn` uses the stored open turn.
