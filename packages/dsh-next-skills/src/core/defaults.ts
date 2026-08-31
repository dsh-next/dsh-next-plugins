/**
 * Default skill providers seeded on first launch (when no provider list has
 * been persisted yet). Users can remove or extend them like any other
 * provider; removals persist.
 */
export const DEFAULT_PROVIDER_SPECS: readonly string[] = [
  'anthropics/skills',
  'openclaw/openclaw',
  'mattpocock/skills',
  'muratcankoylan/Agent-Skills-for-Context-Engineering',
  'affaan-m/ecc',
  'nextlevelbuilder/ui-ux-pro-max-skill',
  'addyosmani/agent-skills',
  'Leonxlnx/taste-skill',
]
