/** Bounded, disposable browser requests. Closing presence alone may outlive teardown. */
import type { MessageKey } from './dictionaries.ts'

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string
export function createRpc(path: string, t: Translate, fetcher: typeof fetch = fetch) {
  let disposed = false
  const requests = new Set<AbortController>()
  const request = async (method: string, args?: unknown): Promise<unknown> => {
    const closing = method === 'reportPresence' && !!args && typeof args === 'object' && 'open' in args && args.open === false
    if (disposed && !closing) throw new Error(t('rpc.disposed'))
    const controller = new AbortController()
    if (!closing) requests.add(controller)
    const timeout = setTimeout(() => controller.abort(new Error(t('rpc.timeout', { method }))), 8000)
    try {
      const res = await fetcher(path, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ method, args: args ?? null }),
        signal: controller.signal, keepalive: closing,
      })
      if (!res.ok) throw new Error(t('rpc.failed', { method, status: res.status }))
      return await res.json()
    } finally {
      clearTimeout(timeout)
      requests.delete(controller)
    }
  }
  return { request, dispose: () => {
    disposed = true
    for (const controller of requests) controller.abort(new Error(t('rpc.disposed')))
    requests.clear()
  } }
}
