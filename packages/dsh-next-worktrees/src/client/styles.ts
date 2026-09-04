/**
 * Plugin-owned stylesheet for the derived workspace browser's worktree
 * decorations. The official rows use CSS Modules we cannot reach; our
 * injected markup carries the `dshx-` class names styled here. Tokens
 * only (docs/i18n.md of design: --dsw-* are the only colors we may
 * name); monochrome for Phase 2 — state colors arrive with the row menu.
 */
export const WORKTREE_STYLES = `
.dshx-sessionRow--worktree {
  padding-left: 24px;
}
.dshx-worktree-identity {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  flex: none;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dshx-worktree-identity svg {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.dshx-worktree-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}
.dshx-worktree-status {
  flex: none;
  color: var(--dsw-alias-label-caption);
}
.dshx-worktree-status[data-state='ahead'],
.dshx-worktree-status[data-state='dirty'] {
  color: var(--dsw-alias-label-secondary);
}
`
