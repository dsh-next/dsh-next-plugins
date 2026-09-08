# Cluster hover matches stock folder chevron swap

- date: 2026-09-08
- status: implemented
- scope: packages/dsh-next-worktrees

The cluster put the branch glyph in the official folder slot but dropped
the `folder` class, so hover revealed the chevron *and* kept the branch
(title jumped). Restore `folder` so official CSS hides the glyph and shows
the chevron. Cluster nest is 16px. Sessions live inside HoverCard, so a
`dshx-clusterSession` class nests them 16px too (sibling selectors never
matched). Drop the -14px identity pull that fought the slot.
