# checkpoints review leftovers

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-checkpoints

Closed the optional leftovers from the checkpoints review:

- File rows now use `file.created` / `file.deleted` as labels; DiffBlock
  still renders for those kinds.
- The Changes `conversation.view` registration is inside `ctx.effect` so
  unload disposes it.
- Host `capture` RPC is disabled unless `DSH_NEXT_CHECKPOINTS_CAPTURE=1`
  (set by `scripts/e2e-mount.sh`). Direct `CheckpointsService.capture`
  stays available to unit tests.
- Playwright asserts the Created label and that a CRLF-only change to a
  tracked file does not appear as a net diff.
