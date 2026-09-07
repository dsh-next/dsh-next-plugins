/** Checkpoint rail geometry, mirrored from AppFrame's sidebar contract. */

export const RAIL_MIN = 180
export const RAIL_MAX = 420
export const RAIL_DEFAULT = 240
/** Closed-sidebar rail: 24px icon column between paddings. */
export const RAIL_COLLAPSED = 56
/** Collapse the checkpoint rail when the Changes view is this narrow. */
export const RAIL_NARROW = 720

export function clampRailWidth(px: number): number {
  if (!Number.isFinite(px)) return RAIL_DEFAULT
  return Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(px)))
}
