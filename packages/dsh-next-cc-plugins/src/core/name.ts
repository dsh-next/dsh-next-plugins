/**
 * Skill-name grammar. Matches the DSH registry's kebab-case identifier rule:
 * lowercase alphanumeric segments separated by single hyphens.
 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isSkillName(name: string): boolean {
  return SKILL_NAME.test(name)
}

/**
 * Sanitize an arbitrary identifier (Claude plugin name, MCP server name) into
 * a string usable inside a Cordis row id or an MCP `serverName`
 * (`[A-Za-z0-9_-]{1,32}`): replace every character outside that class with
 * `-`, collapse runs, trim leading/trailing hyphens, and truncate to 32.
 * Returns '' when nothing usable remains.
 */
export function sanitizeIdentifier(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

/**
 * Whether a name is valid as an MCP `serverName` per the dsh-mcp-client
 * contract: 1-32 characters of letters, digits, underscore, or hyphen.
 */
export function isMcpServerName(name: string): boolean {
  return /^[A-Za-z0-9_-]{1,32}$/.test(name)
}
