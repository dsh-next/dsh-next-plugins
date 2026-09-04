/**
 * The plugin-owned seat around the official Workspace Browser.
 *
 * Strategy B (docs/ideas/dsh-next-worktrees-sidebar-ux.md): this plugin
 * replaces the stock `ui-workspace` loader row and registers the official
 * browser, wrapped here. Phase 1 passes every prop through unchanged —
 * ownership proven, zero behavior delta. The nesting projection (re-parent
 * worktree sessions under their repo group, hide the worktree workspace
 * groups, badge and indent the rows) lands as the next concern in this
 * wrapper: it receives the same store hooks the official Browser uses and
 * will feed it projected state, exactly the seam the incumbent proved.
 */
import * as React from 'react'

/** Minimal component shape the wrapper needs from the official Browser. */
export type OfficialBrowserComponent = React.ComponentType<Record<string, unknown>>

/** Props the wrapper adds beyond the official Browser's own. */
export interface WorktreeBrowserExtraProps {
  readonly OfficialBrowser: OfficialBrowserComponent
}

/**
 * Render the official Browser with worktree-aware props.
 *
 * @param props - the sidebar slot's render props plus the official
 * component to wrap.
 * @returns the official Browser element.
 */
export function WorktreeBrowser(
  props: WorktreeBrowserExtraProps & Record<string, unknown>,
): React.ReactElement {
  const { OfficialBrowser, ...officialProps } = props
  return <OfficialBrowser {...officialProps} />
}
