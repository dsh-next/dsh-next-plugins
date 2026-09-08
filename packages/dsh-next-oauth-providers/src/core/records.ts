/**
 * OAuth grant payload stored as a DSH CredentialRecord `grant`.
 * Tokens never enter settings.yaml; this module only validates shape.
 */

export interface OauthGrant {
  readonly type: 'oauth'
  readonly access: string
  readonly refresh: string
  readonly expires: number
  readonly [key: string]: unknown
}

export function isOauthGrant(value: unknown): value is OauthGrant {
  if (value === null || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  return row.type === 'oauth'
    && typeof row.access === 'string' && row.access.length > 0
    && typeof row.refresh === 'string' && row.refresh.length > 0
    && typeof row.expires === 'number' && Number.isFinite(row.expires)
}

/**
 * Drop explicit `undefined` so the credential store's JSON validator accepts
 * the payload (same rule official llm-pi-ai uses).
 */
export function jsonImage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => entry === undefined ? null : jsonImage(entry))
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const image: Record<string, unknown> = {}
    for (const [key, member] of Object.entries(value)) {
      if (member !== undefined) image[key] = jsonImage(member)
    }
    return image
  }
  return value
}

export function grantExpiryMs(grant: OauthGrant): number {
  return grant.expires > 1_000_000_000_000 ? grant.expires : grant.expires * 1000
}

export function grantExpired(grant: OauthGrant, now = Date.now()): boolean {
  return grantExpiryMs(grant) <= now
}

/** Safe label for UI: never the token. */
export function grantAccountLabel(grant: OauthGrant): string | undefined {
  for (const key of ['accountId', 'email', 'login', 'name'] as const) {
    const value = grant[key]
    if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  }
  return undefined
}
