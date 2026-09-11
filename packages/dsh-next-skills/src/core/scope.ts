/** Global skill roots managed by this plugin, in native discovery precedence. */
import type { SkillSourceBucket } from './types.ts'
import { joinPath } from './path.ts'

export const USER_DSH_RANK = 400
export const USER_AGENTS_RANK = 500

export interface SkillRoot {
  path: string
  source: SkillSourceBucket
  rank: number
}

export interface ResolveRootsOptions {
  /** DSH config root (defaults to $DSH_HOME or ~/.dsh in the host). */
  dshHome: string
  /** Shared agent config root (defaults to $DSH_AGENTS_HOME or ~/.agents). */
  agentsHome: string
}

export function resolveSkillRoots(opts: ResolveRootsOptions): SkillRoot[] {
  return [
    { path: joinPath(opts.dshHome, 'skills'), source: 'user-dsh', rank: USER_DSH_RANK },
    { path: joinPath(opts.agentsHome, 'skills'), source: 'user-agents', rank: USER_AGENTS_RANK },
  ]
}

/** Sort roots by precedence (lowest rank first). */
export function sortRootsByPrecedence(roots: readonly SkillRoot[]): SkillRoot[] {
  return [...roots].sort((a, b) => a.rank - b.rank)
}

/** The root a global install should land in (user-agents, the shared convention). */
export function globalSkillsRoot(agentsHome: string): string {
  return joinPath(agentsHome, 'skills')
}
