/** Settings namespace and credential-record scope this plugin owns. */
export const SETTINGS_NS = 'dsh-next-oauth-providers' as const

/** Credential-record scope; must be a lowercase hyphenated identifier. */
export const RECORD_SCOPE = 'dsh-next-oauth-providers' as const

/** Same-origin RPC path the browser half posts to. */
export const RPC_PATH = '/dsh-next-oauth-providers/rpc'

/** Login attempt bound (ms). Providers may expire sooner. */
export const LOGIN_TIMEOUT_MS = 15 * 60 * 1000

/**
 * Cancel an attempt if the owner tab stops polling. Keep this at the login
 * bound: ChatGPT's workspace step often happens in another tab, and browsers
 * throttle background timers so a 60s lease aborts a still-valid callback.
 */
export const OWNER_LEASE_MS = LOGIN_TIMEOUT_MS

/** Adapter stream idle timeout, matching official llm-pi-ai defaults. */
export const STREAM_IDLE_TIMEOUT_MS = 300_000

/** Request-level base64 image payload bound (20 MiB). */
export const MAX_REQUEST_IMAGE_BYTES = 20 * 1024 * 1024

/** Total-pixel budget for inline request images. */
export const REQUEST_IMAGE_PIXEL_BUDGET = 4_194_304

/** Raw encoded-byte target for inline request images. */
export const REQUEST_IMAGE_MAX_BYTES = 1_048_576

/** Conservative context for an unlisted model id (256K). */
export const UNKNOWN_MODEL_CONTEXT_WINDOW = 256_000

/** Conservative output cap for an unlisted model id (64K). */
export const UNKNOWN_MODEL_MAX_TOKENS = 64_000
