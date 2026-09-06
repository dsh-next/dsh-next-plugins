/**
 * Whether a session log has never started a turn. `command/run` for `/reset`
 * itself does not count — the registry appends it before the handler.
 */
const UTILIZED = new Set(['user/message', 'turn/start'])

/** True when the log has no user turn (a blank session `/reset` no-ops). */
export function sessionIsBlank(events: readonly { readonly type: string }[]): boolean {
  return !events.some((event) => UTILIZED.has(event.type))
}
