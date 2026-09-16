
/**
 * Session-header fetch patch, host half.
 *
 * The OpenCode Go provider (endpoint https://opencode.ai/zen/go) rejects
 * requests without an `x-opencode-session` header (HTTP 400 MissingSessionID),
 * and neither pi-ai nor the dsh llm-pi-ai adapter exposes a per-request header
 * seam. This module patches the host-process `globalThis.fetch` (effect
 * scoped; the original is restored on dispose) and stamps the header with the
 * current dsh session id on every request to that endpoint.
 *
 * Session attribution: the dsh agent registry keeps an AsyncLocalStorage
 * initiator scope and the agent loop kicks every turn inside it, so any LLM
 * fetch issued within a turn inherits the initiating Agent. Calls outside any
 * initiator boundary share the stable fallback id.
 */

/** Header OpenCode Go requires on every request. */
export const HEADER_NAME = 'x-opencode-session'

/** OpenCode Go endpoint prefix every provider API (anthropic/openai) shares. */
export const OPENCODE_GO_ORIGIN = 'https://opencode.ai/zen/go'

/** Stable id for agentless calls (no initiator boundary active). */
export const AGENTLESS = 'dsh'

/** Minimal shape this module needs from the agent registry. */
export interface InitiatorLookup {
  currentInitiator(): { id: string } | undefined
}

/** Extract the request URL from any fetch input form. */
export function requestUrl(input: RequestInfo | URL): string | undefined {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** Resolve the session id a request should be stamped with. */
export function sessionValueFor(currentInitiator: () => { id: string } | undefined): string {
  try {
    return String(currentInitiator()?.id ?? AGENTLESS)
  } catch {
    // The registry refuses reads after disposal; those requests are agentless.
    return AGENTLESS
  }
}

/** Install the fetch patch; disposal restores the original fetch. */
export function applySessionHeaderPatch(agents: InitiatorLookup, log: (message: string) => void): () => void {
  const original = globalThis.fetch
  const patched: typeof fetch = (input, init) => {
    const url = requestUrl(input)
    if (url === undefined || !url.startsWith(OPENCODE_GO_ORIGIN)) return original(input, init)
    const session = sessionValueFor(() => agents.currentInitiator())
    const headers = new Headers(init?.headers)
    if (init === undefined && input instanceof Request) {
      for (const [key, value] of input.headers) headers.set(key, value)
    }
    headers.set(HEADER_NAME, session)
    // console over a logger: the host filters info-level plugin logs, but this
    // line is the ops-visible proof of what was sent to the gateway
    log(`opencode-go: ${HEADER_NAME}: ${session}`)
    if (init === undefined && input instanceof Request) {
      return original(new Request(input, { headers }), undefined)
    }
    return original(input, { ...init, headers })
  }
  globalThis.fetch = patched
  return () => {
    globalThis.fetch = original
  }
}
