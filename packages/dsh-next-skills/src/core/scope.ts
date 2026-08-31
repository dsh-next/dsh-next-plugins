/**
 * Pure skill-root resolution mirroring the DSH filesystem provider's roots:
 * project roots (workspace), custom roots, then user roots (global). Lower
 * rank wins duplicate skill names; project `.agents/skills` (200) therefore
 * shadows the user `~/.agents/skills` (500).
 */
import type { SkillScope, SkillSourceBucket } from './types.ts'
import { joinPath } from './path.ts'

export const PROJECT_DSH_RANK = 100
export const PROJECT_AGENTS_RANK = 200
export const CUSTOM_RANK = 300
export const USER_DSH_RANK = 400
export const USER_AGENTS_RANK = 500
export const BUNDLED_SKILL_RANK = 600

export interface SkillRoot {
  path: string
  source: SkillSourceBucket
  scope: SkillScope
  rank: number
}

export interface ResolveRootsOptions {
  /** The workspace/project root, when one is in context. */
  projectRoot?: string
  /** DSH config root (defaults to $DSH_HOME or ~/.dsh in the host). */
  dshHome: string
  /** Shared agent config root (defaults to $DSH_AGENTS_HOME or ~/.agents). */
  agentsHome: string
  /** Additional roots scanned after project roots and before user roots. */
  customSkillDirs?: string[]
}

export function resolveSkillRoots(opts: ResolveRootsOptions): SkillRoot[] {
  const roots: SkillRoot[] = []
  if (opts.projectRoot !== undefined) {
    roots.push(
      { path: joinPath(opts.projectRoot, '.dsh/skills'), source: 'project-dsh', scope: 'workspace', rank: PROJECT_DSH_RANK },
      { path: joinPath(opts.projectRoot, '.agents/skills'), source: 'project-agents', scope: 'workspace', rank: PROJECT_AGENTS_RANK },
    )
  }
  for (const dir of opts.customSkillDirs ?? []) {
    roots.push({ path: dir, source: 'custom', scope: 'global', rank: CUSTOM_RANK })
  }
  roots.push(
    { path: joinPath(opts.dshHome, 'skills'), source: 'user-dsh', scope: 'global', rank: USER_DSH_RANK },
    { path: joinPath(opts.agentsHome, 'skills'), source: 'user-agents', scope: 'global', rank: USER_AGENTS_RANK },
  )
  return roots
}

/** Sort roots by precedence (lowest rank first). */
export function sortRootsByPrecedence(roots: readonly SkillRoot[]): SkillRoot[] {
  return [...roots].sort((a, b) => a.rank - b.rank)
}

/** The root a global install should land in (user-agents, the shared convention). */
export function globalSkillsRoot(agentsHome: string): string {
  return joinPath(agentsHome, 'skills')
}

/** The root a workspace install should land in (project-agents). */
export function workspaceSkillsRoot(projectRoot: string): string {
  return joinPath(projectRoot, '.agents/skills')
}
