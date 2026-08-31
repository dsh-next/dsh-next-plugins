/**
 * Skill-name grammar. Matches the DSH registry's kebab-case identifier rule:
 * lowercase alphanumeric segments separated by single hyphens.
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}
