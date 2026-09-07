# checkpoints review: bugs and edge-case coverage

- date: 2026-09-06
- status: implemented
- scope: packages/dsh-next-checkpoints

Code review of the checkpoints MVP found real correctness gaps, then
closed them with unit tests and a dedicated Playwright lane.

Required fixes: await `noteIntent` before `fs` `next()` so first-seen
baseline is pre-mutation; serialize list/diffs/preview/rewind/capture on
the session queue and drain `whenIdle`; parse `git status --porcelain -z`
renames without slicing the old path; confine restore paths to the
session cwd; treat missing text blobs and late NULs honestly; seed
already-dirty files at attach so pre-session dirt is not a fake create;
sort surface seqs before replace; keep truncating the generation if
surface replace throws; warn/block when a snapshotted symlink or
directory can no longer be restored; keep a `seqCursor` so capture after
rewind cannot reuse a dropped checkpoint id; ignore stale list RPC
responses in the Changes tab.

README install copy is the npm name. Completeness tests now cover
core/host/client error branches. Playwright lane: inspect + two-step
rewind + HEAD-moved warning + post-rewind generation, plus binary rows
and multi-file inspect.
