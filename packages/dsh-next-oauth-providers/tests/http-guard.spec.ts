import { describe, expect, it } from 'vitest'
import { Socket } from 'node:net'
import type { IncomingMessage } from 'node:http'
import { RpcError } from '../src/core/errors.ts'
import { createServer } from 'node:net'
import { assertLocalOwner, assertLoopbackPortFree, isUnsafeOauthHost } from '../src/host/http-guard.ts'

function req(init: { remoteAddress: string; host?: string; origin?: string }): IncomingMessage {
  const socket = { remoteAddress: init.remoteAddress } as Socket
  const headers: Record<string, string> = {}
  if (init.host !== undefined) headers.host = init.host
  if (init.origin !== undefined) headers.origin = init.origin
  return { socket, headers } as IncomingMessage
}

describe('assertLocalOwner', () => {
  it('allows loopback with localhost Host', () => {
    expect(() => assertLocalOwner(req({ remoteAddress: '127.0.0.1', host: '127.0.0.1:3080' }))).not.toThrow()
  })

  it('rejects a non-loopback peer', () => {
    expect(() => assertLocalOwner(req({ remoteAddress: '10.0.0.2', host: '127.0.0.1' }))).toThrow(RpcError)
  })

  it('rejects a cross-site Origin', () => {
    expect(() => assertLocalOwner(req({
      remoteAddress: '127.0.0.1',
      host: '127.0.0.1:3080',
      origin: 'https://evil.example',
    }))).toThrow(/cross-origin/)
  })
})

describe('isUnsafeOauthHost', () => {
  it('rejects non-loopback callback hosts', () => {
    expect(isUnsafeOauthHost('0.0.0.0')).toBe(true)
    expect(isUnsafeOauthHost('127.0.0.1')).toBe(false)
    expect(isUnsafeOauthHost(undefined)).toBe(false)
  })
})

describe('assertLoopbackPortFree', () => {
  it('rejects a port that is already listening', async () => {
    const holder = createServer()
    const occupied = await new Promise<number>((resolve, reject) => {
      holder.listen(0, '127.0.0.1', () => {
        const address = holder.address()
        if (address === null || typeof address === 'string') {
          reject(new Error('expected a TCP address'))
          return
        }
        resolve(address.port)
      })
    })
    try {
      await expect(assertLoopbackPortFree(occupied)).rejects.toMatchObject({ code: 'port', params: { port: occupied } })
    } finally {
      await new Promise<void>((resolve) => { holder.close(() => resolve()) })
    }
  })
})
