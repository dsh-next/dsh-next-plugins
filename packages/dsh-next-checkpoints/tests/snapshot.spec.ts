import { describe, expect, it } from 'vitest'
import { classifyBytes } from '../src/host/snapshot.ts'
import { DIFF_MAX_BYTES } from '../src/core/types.ts'

describe('classifyBytes', () => {
  it('labels text, binary, invalid utf-8, and oversize blobs', () => {
    expect(classifyBytes(new TextEncoder().encode('hello\n'))).toBe('text')
    expect(classifyBytes(new Uint8Array([65, 0, 66]))).toBe('binary')
    expect(classifyBytes(new Uint8Array([0x80]))).toBe('invalid-utf8')
    expect(classifyBytes(new Uint8Array(DIFF_MAX_BYTES + 1))).toBe('too-large')
  })
})
