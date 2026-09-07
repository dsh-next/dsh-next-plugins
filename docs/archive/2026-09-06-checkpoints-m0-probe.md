# dsh-next-checkpoints M0 probe results

- date: 2026-09-06
- status: validation snapshot
- scope: docs/ideas/dsh-next-checkpoints.md

Throwaway probe against the installed `0.1.2-rc.1` `@deepseek-ai/dsh-session`
`Session` (the same `append` + `deriveMessages` a host plugin calls) plus a
scratch git repo for file restore. Script: `docs/archive/m0-checkpoints-probe.mjs`.

## (3) In-place surface replace is plugin-legal

Two user/assistant surface pairs, then a `user/message` with
`surfaceOp: { op: 'replace', start, end }` covering turn 2, `sourceEventSeqs`
set to the shadowed nodes, source `{ kind: 'plugin', plugin: 'dsh-next-checkpoints',
form: 'notice' }`.

- Before: four derived messages, including turn 2.
- After: turn 1 plus the rewind notice. Turn 2 text is absent.
- Surface nodes: `[0, 1, 4]`. Append-only log length 5 (shadowed events kept).

Pass. Scaffolding is unblocked. Compaction's replace path is the precedent;
any surface-replacing producer may use it (`SurfaceOp` docs).

## (4) Chat tab

Not a live GUI observation. SDK contract: Chat's human transcript is
append-origin (`isAppendSurfaceEvent`); replacement copies stay model-only.
Later bubbles remain. v1 ships the Changes-tab banner
(`Rewound to this checkpoint. Later messages are not sent to the model.`).
Do not wrap ChatView.

## (5) File restore is not git

Scratch repo: commit `v0`, dirty the file to `v2`, restore snapshot `v1`.
Disk matches the snapshot; `HEAD` is unchanged.

## Conclusion

v1 is files + model replace + banner, in-place on the live session. Fork
stays fallback-only. Package stays `"private": true` until this rewind
path is covered by the plugin's own tests.
