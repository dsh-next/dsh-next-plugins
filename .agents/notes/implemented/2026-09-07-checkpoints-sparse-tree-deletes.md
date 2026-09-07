# checkpoints sparse tree false deletes

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

Selecting an earlier chat-only checkpoint listed later-edited files as
Deleted. Turn trees are sparse: they only record paths inspected at that
turn. A later edit first-sees the path into `baseline`, and `projectRows`
treated "in baseline, absent from this tree" as a delete.

`overlayTree` now fills a checkpoint from the session baseline. Absent
paths inherit; only an explicit `kind: 'missing'` entry is a delete.
Rewind writes that overlay and only deletes paths that are missing on it
(later creates, recorded deletes). `snapshotTurn` re-inspects known
baseline/previous paths so a real delete is recorded as missing.
