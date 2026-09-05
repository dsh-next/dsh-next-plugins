/**
 * Plugin-owned stylesheet for the derived workspace browser's worktree
 * decorations. The official rows use CSS Modules we cannot reach; our
 * injected markup carries the `dshx-` class names styled here. Tokens
 * only (docs/i18n.md of design: --dsw-* are the only colors we may
 * name). The worktree icon IS the status surface (rev 3): green merged,
 * amber dirty, blue ahead, neutral clean — first match wins, computed in
 * the seam and carried by `data-dshx-state`.
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
  /* Read as a leading glyph of the session title, not a separate chip:
     pull back over the official row's flex gap. */
  margin-right: -14px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  line-height: 18px;
}
.dshx-worktree-identity svg {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
}
.dshx-worktree-identity[data-dshx-state='merged'] svg {
  color: var(--dsw-alias-state-success-primary);
}
.dshx-worktree-identity[data-dshx-state='dirty'] svg {
  color: var(--dsw-alias-state-warn-primary);
}
.dshx-worktree-identity[data-dshx-state='ahead'] svg {
  color: var(--dsw-alias-state-business-primary);
}
.dshx-worktree-ahead {
  flex: none;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-state-business-primary);
  font-variant-numeric: tabular-nums;
}
.dshx-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: var(--dsw-alias-bg-mask-1);
  backdrop-filter: var(--dsw-mask-blur);
  display: flex;
  align-items: center;
  justify-content: center;
}
.dshx-modal {
  position: relative;
  z-index: 1;
  width: 400px;
  max-width: calc(100vw - 48px);
  box-sizing: border-box;
  background: var(--dsw-alias-bg-layer-2);
  border: 0;
  border-radius: 12px;
  box-shadow: var(--dsw-elevation-prominent);
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.dshx-modalTitle {
  font-size: 15px;
  line-height: 1.4;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.dshx-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dshx-fieldLabel {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.dshx-fieldHint {
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-caption);
}
.dshx-input {
  height: 34px;
  box-sizing: border-box;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  padding: 0 10px;
  font-size: 13px;
  line-height: 20px;
}
.dshx-input:focus {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: -1px;
}
.dshx-input:disabled {
  opacity: 0.4;
}
.dshx-error {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-state-error-primary);
}
.dshx-modalActions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dshx-buttonGhost {
  height: 34px;
  padding: 0 14px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}
.dshx-buttonGhost:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshx-buttonGhost:disabled,
.dshx-buttonPrimary:disabled {
  opacity: 0.4;
  cursor: default;
}
.dshx-buttonPrimary {
  height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground);
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}
.dshx-buttonPrimary:hover {
  background: var(--dsw-alias-button-primary-hover);
}
.dshx-buttonGhost:focus-visible,
.dshx-buttonPrimary:focus-visible,
.dshx-buttonDanger:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dshx-modalBody {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dshx-factLine {
  font-size: 13px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
  word-break: break-word;
}
.dshx-doneTitle {
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dshx-blockers {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dshx-buttonDanger {
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-state-error-primary);
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-state-error-primary);
  font-size: 14px;
  line-height: 22px;
  cursor: pointer;
}
.dshx-buttonDanger:hover {
  background: var(--dsw-alias-interactive-bg-hover-danger);
}
.dshx-buttonDanger:disabled {
  opacity: 0.4;
  cursor: default;
}
`
