/**
 * Local Web GUI only: loopback peer, expected Host, same-origin Origin.
 */
import { createServer } from 'node:net'
import type { IncomingMessage } from 'node:http'
import { RpcError } from '../core/errors.ts'
import type { NativeId } from '../core/catalog.ts'

/** Loopback ports pi-ai binds for browser OAuth callbacks. */
export const OAUTH_CALLBACK_PORTS: Readonly<Partial<Record<NativeId, number>>> = {
  'openai-codex': 1455,
  anthropic: 53692,
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

export function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name]
  if (typeof raw === 'string' && raw.length > 0) return raw
  if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].length > 0) return raw[0]
  return undefined
}

export function assertLocalOwner(req: IncomingMessage): void {
  const addr = req.socket.remoteAddress ?? ''
  if (!LOOPBACK.has(addr)) {
    throw new RpcError('origin', 'subscription OAuth is only available on the local Web GUI')
  }
  const host = (headerValue(req, 'host') ?? '').split(':')[0]?.toLowerCase() ?? ''
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new RpcError('origin', 'subscription OAuth requires a loopback Host')
  }
  const origin = headerValue(req, 'origin')
  if (origin === undefined) return
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new RpcError('origin', 'invalid Origin')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new RpcError('origin', 'invalid Origin')
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new RpcError('origin', 'cross-origin requests are not allowed')
  }
}

export function isUnsafeOauthHost(value: string | undefined): boolean {
  if (value === undefined || value === '') return false
  const trimmed = value.trim().toLowerCase()
  return trimmed !== '127.0.0.1' && trimmed !== 'localhost'
}

/** Fail before pi-ai swallows EADDRINUSE and ChatGPT spins on a stolen callback. */
export function assertLoopbackPortFree(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    const fail = (error: NodeJS.ErrnoException): void => {
      server.removeAllListeners()
      if (error.code === 'EADDRINUSE') {
        reject(new RpcError(
          'port',
          `callback port ${String(port)} is already in use`,
          { port },
        ))
        return
      }
      reject(error)
    }
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => {
      server.close((closeError) => {
        if (closeError !== undefined && closeError !== null) {
          reject(closeError)
          return
        }
        resolve()
      })
    })
  })
}
