/**
 * Ownership provenance for skills managed by an external plugin (the
 * cc-plugins bridge). A sidecar JSON file written next to a skill's SKILL.md
 * marks that skill as externally-owned: the Skills UI renders it read-only
 * and the service refuses to delete or re-scope it, so a claude plugin's
 * skill cannot be orphaned while the rest of the plugin is still installed.
 *
 * The sidecar is pure data: reading it never mutates state, and a missing or
 * malformed sidecar simply means "not externally managed".
 */

/** Sidecar filename written beside an externally-managed skill. */
export const OWNERSHIP_SIDECAR = '.dsh-next-skill-owner.json'

/** The identifying owner constant for skills installed by cc-plugins. */
export const CC_OWNER = 'cc-plugins'

/** One parsed ownership record (undefined when absent or malformed). */
export interface SkillOwnership {
  /** The owning plugin (e.g. `cc-plugins`). */
  owner: string
  /** The owning plugin's stable key for this install (`<marketplaceId>/<pluginName>`). */
  pluginKey: string
  /** The marketplace id the skill came from (provenance display only). */
  marketplaceId: string
  /** The skill's registry name (mirrors the directory name). */
  skillName: string
}

/**
 * Parse a raw sidecar document into {@link SkillOwnership}; undefined when
 * the document is not a valid ownership record. Defensive: never throw.
 */
export function parseOwnership(raw: unknown): SkillOwnership | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const r = raw as Record<string, unknown>
  const strings = ['owner', 'pluginKey', 'marketplaceId', 'skillName'] as const
  for (const key of strings) {
    if (typeof r[key] !== 'string' || (r[key] as string) === '') return undefined
  }
  return {
    owner: r.owner as string,
    pluginKey: r.pluginKey as string,
    marketplaceId: r.marketplaceId as string,
    skillName: r.skillName as string,
  }
}

/** Whether a parsed record is owned by the cc-plugins bridge. */
export function isCcOwned(ownership: SkillOwnership | undefined): boolean {
  return ownership?.owner === CC_OWNER
}

/** The JSON text persisted as the sidecar for one externally-owned skill. */
export function ownershipSidecarText(ownership: SkillOwnership): string {
  return JSON.stringify(ownership, null, 2)
}
