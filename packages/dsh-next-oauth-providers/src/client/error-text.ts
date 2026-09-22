/**
 * Shared error copy: an RPC failure becomes its dictionary key, anything else
 * the generic unknown error.
 */
import { ClientRpcError } from './api.ts'
import type { MessageKey } from './dictionaries.ts'

export function errorText(error: unknown, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  if (error instanceof ClientRpcError) {
    // A status param means the request never reached the plugin's own handler:
    // the host half did not register its route (usually a stale process after
    // a rebuild), which is not the same failure as a rejected RPC.
    if (typeof error.params?.status === 'number') return t('error.transport')
    return t(`error.${error.code}` as MessageKey, error.params)
  }
  return t('error.unknown')
}
