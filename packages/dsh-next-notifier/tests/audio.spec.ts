import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAudioPlayer } from '../src/client/audio.ts'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state = 'running'
  destination = {}
  sources: { buffer: unknown; connect: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; onended: (() => void) | null }[] = []
  resume = vi.fn(async () => { this.state = 'running' })
  close = vi.fn(async () => { this.state = 'closed' })
  createBuffer = vi.fn((_channels: number, length: number, _rate: number) => ({ getChannelData: () => new Float32Array(length) }))
  createBufferSource = vi.fn(() => {
    const source = { buffer: null as unknown, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null as (() => void) | null }
    this.sources.push(source)
    return source
  })
  constructor() { FakeAudioContext.instances.push(this) }
}
beforeEach(() => { FakeAudioContext.instances = []; vi.stubGlobal('AudioContext', FakeAudioContext) })
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('receiving-device sound player', () => {
  it('allocates lazily, rejects invalid sound/volume and never creates host processes', async () => {
    const audio = createAudioPlayer()
    for (const [id, volume] of [['unknown', 70], ['chime', 0], ['chime', -1], ['chime', NaN]] as const) {
      expect(await audio.play(id, volume)).toBe(false)
    }
    expect(FakeAudioContext.instances).toHaveLength(0)
    audio.dispose()
    expect(await audio.play('chime', 70)).toBe(false)
  })
  it('synthesizes locally, reuses context, disconnects ended sources and disposes live ones', async () => {
    const audio = createAudioPlayer()
    expect(await audio.play('chime', 70)).toBe(true)
    const context = FakeAudioContext.instances[0]
    expect(context.createBuffer).toHaveBeenCalledWith(1, expect.any(Number), 22050)
    expect(context.sources[0].start).toHaveBeenCalledOnce()
    context.sources[0].onended!()
    expect(context.sources[0].disconnect).toHaveBeenCalledOnce()
    expect(await audio.play('ping', 40)).toBe(true)
    expect(FakeAudioContext.instances).toHaveLength(1)
    audio.dispose()
    audio.dispose()
    expect(context.sources[0].stop).not.toHaveBeenCalled()
    expect(context.sources[1].stop).toHaveBeenCalledOnce()
    expect(context.sources[1].onended).toBeNull()
    expect(context.close).toHaveBeenCalledOnce()
  })
  it('does not await a user gesture for background delivery', async () => {
    const audio = createAudioPlayer()
    await audio.play('ping', 10)
    const context = FakeAudioContext.instances[0]
    context.state = 'suspended'
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } })
    expect(await audio.play('ping', 10)).toBe(false)
    expect(context.resume).not.toHaveBeenCalled()
    audio.dispose()
  })
  it('resumes from an explicit preview gesture but ignores late resume after disposal', async () => {
    const audio = createAudioPlayer()
    await audio.play('ping', 10)
    const context = FakeAudioContext.instances[0]
    context.state = 'suspended'
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true } })
    expect(await audio.play('ping', 10)).toBe(true)
    expect(context.resume).toHaveBeenCalledOnce()
    context.state = 'suspended'
    let resume!: () => void
    context.resume.mockImplementation(() => new Promise<void>(resolve => { resume = resolve }))
    const pending = audio.play('ping', 10)
    audio.dispose()
    resume()
    expect(await pending).toBe(false)
    expect(context.sources).toHaveLength(2)
  })
  it('contains unsupported APIs, failed resume, and audio allocation errors', async () => {
    vi.stubGlobal('AudioContext', undefined)
    expect(await createAudioPlayer().play('chime', 70)).toBe(false)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    const audio = createAudioPlayer()
    await audio.play('ping', 10)
    const context = FakeAudioContext.instances[0]
    context.state = 'suspended'
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true } })
    context.resume.mockRejectedValue(new Error('blocked'))
    expect(await audio.play('ping', 10)).toBe(false)
    context.state = 'closed'
    expect(await audio.play('ping', 10)).toBe(false)
    context.state = 'running'
    context.createBuffer.mockImplementation(() => { throw new Error('allocation failed') })
    expect(await audio.play('ping', 10)).toBe(false)
    context.close.mockRejectedValue(new Error('already closed'))
    context.sources[0].stop.mockImplementation(() => { throw new Error('ended') })
    expect(() => audio.dispose()).not.toThrow()
    await Promise.resolve()
  })
})
