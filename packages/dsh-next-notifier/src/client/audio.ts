import { SOUNDS, SAMPLE_RATE } from '../core/sounds.ts'
import { synthesize, volumeGain } from '../core/synth.ts'

/** Audio belongs to the receiving client, never to the machine running the host. */
export function createAudioPlayer() {
  let context: AudioContext | undefined
  let disposed = false
  const sources = new Set<AudioBufferSourceNode>()
  async function play(id: string, volume: number): Promise<boolean> {
    const sound = SOUNDS.find(item => item.id === id)
    if (disposed || !sound || !Number.isFinite(volume) || volume <= 0) return false
    try {
      context ??= new AudioContext()
      // A preview button can unlock audio; background delivery never waits for a gesture.
      if (context.state === 'suspended') {
        if (!navigator.userActivation?.isActive) return false
        await context.resume()
      }
      if (disposed || context.state !== 'running') return false
      const samples = synthesize(sound, volumeGain(volume))
      const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE)
      buffer.getChannelData(0).set(samples)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.connect(context.destination)
      source.onended = () => { sources.delete(source); source.disconnect() }
      sources.add(source)
      source.start()
      return true
    } catch { return false }
  }
  return {
    play,
    dispose() {
      if (disposed) return
      disposed = true
      for (const source of sources) {
        source.onended = null
        try { source.stop(); source.disconnect() } catch {}
      }
      sources.clear()
      void context?.close().catch(() => {})
    },
  }
}
