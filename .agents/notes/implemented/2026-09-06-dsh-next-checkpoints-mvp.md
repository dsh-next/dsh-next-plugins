# dsh-next-checkpoints MVP

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-checkpoints

First implementation of the checkpoints plugin from
docs/ideas/dsh-next-checkpoints.md. M0 (docs/archive/2026-09-06-checkpoints-m0-probe.md)
proved in-place `surfaceOp: replace` is plugin-legal: `deriveMessages()` omits
the shadowed turn; Chat keeps append-origin bubbles so v1 ships the Changes-tab
banner; file restore leaves git HEAD untouched.

Package `@dsh-next/dsh-next-checkpoints` is `"private": true`. Host snapshots a
touched-path tree at `turn/end` (fs intents plus git names vs session-start
HEAD), hunks cumulative net diffs with `structuredPatch`, and rewinds files plus
model history together. Client registers `conversation.view` id `changes`
(order 20). Click selects; rewind control plus confirm modal restores.
`/rewind` never silent-restores.

Not git: no reset/revert/checkout. Moved HEAD is a modal warning.
