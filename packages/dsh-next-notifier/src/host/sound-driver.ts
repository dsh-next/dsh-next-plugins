/**
 * Host-only sound transport: synthesizes the WAVs, base64-encodes them, and
 * writes them into the OS temp dir through the subprocess service (no binary
 * assets, no node dependency in the bundle). Then plays them via the platform
 * player.
 */
import type SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import { SOUNDS } from '../core/sounds.ts'
import { base64Encode, encodeWav, synthesize, volumeGain } from '../core/synth.ts'

export interface Backends {
  win: string | null
  sh: string | null
  afplay: string | null
  paplay: string | null
  aplay: string | null
}

export class SoundDriver {
  soundDir: string | null = null
  private seq = 0

  constructor(private readonly subprocess: SubprocessRuntime | undefined, private readonly cwd: string) {}

  async detect(): Promise<Backends> {
    const [win, sh, afplay, paplay, aplay] = await Promise.all([
      this.resolve('powershell'),
      this.resolve('sh'),
      this.resolve('afplay'),
      this.resolve('paplay'),
      this.resolve('aplay'),
    ])
    return { win, sh, afplay, paplay, aplay }
  }

  private async resolve(cmd: string): Promise<string | null> {
    if (!this.subprocess) return null
    try {
      return await this.subprocess.resolveExecutable(cmd)
    } catch {
      return null
    }
  }

  /** (Re)generate the whole sound set at a given volume; keeps the last good dir on failure. */
  async ensureSounds(volume: number, backends: Backends): Promise<string | null> {
    const gain = volumeGain(volume)
    const seq = ++this.seq
    let dir: string | null = null
    if (backends.win) {
      dir = await this.writeWindows(backends.win, gain)
    } else if (backends.sh) {
      dir = await this.writePosix(backends.sh, gain)
    }
    if (dir && this.seq === seq) this.soundDir = dir
    return this.soundDir
  }

  private async writePosix(sh: string, gain: number): Promise<string | null> {
    const payload = SOUNDS.map((s) => s.id + '\n' + base64Encode(encodeWav(synthesize(s, gain)))).join('\n') + '\n'
    const script = 'd="${TMPDIR:-/tmp}/dsh-next-notifier-sounds"; mkdir -p "$d" && cd "$d" || exit 1; while IFS= read -r name; do IFS= read -r b64; printf %s "$b64" | base64 -d > "$name.wav" 2>/dev/null || printf %s "$b64" | openssl base64 -d -A > "$name.wav"; done; printf %s "$d"'
    return this.collect([sh, '-c', script], payload)
  }

  private async writeWindows(win: string, gain: number): Promise<string | null> {
    const lines = [
      "$dir = Join-Path ([IO.Path]::GetTempPath()) 'dsh-next-notifier-sounds'",
      '[IO.Directory]::CreateDirectory($dir) | Out-Null',
    ]
    for (const sound of SOUNDS) {
      const b64 = base64Encode(encodeWav(synthesize(sound, gain)))
      lines.push(`[IO.File]::WriteAllBytes((Join-Path $dir '${sound.id}.wav'), [Convert]::FromBase64String('${b64}'))`)
    }
    lines.push('Write-Output $dir')
    return this.collect([win, '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', '-'], lines.join('\n'))
  }

  private async collect(argv: string[], stdinData?: string): Promise<string | null> {
    if (!this.subprocess) return null
    try {
      const handle = this.subprocess.spawn({
        argv,
        cwd: this.cwd,
        stdio: { stdin: stdinData === undefined ? 'ignore' : { data: stdinData }, stdout: { maxBytes: 8192 }, stderr: 'inherit' },
        graceMs: 30000,
      })
      await handle.done
      const read = handle.collected && handle.collected.stdout ? handle.collected.stdout.readFrom(0) : null
      return read && read.text ? read.text.trim() : null
    } catch {
      return null
    }
  }

  /** Play a named sound through the detected player; returns false when unavailable. */
  play(name: string, backends: Backends): boolean {
    if (!this.soundDir) return false
    const file = this.soundDir + '/' + name + '.wav'
    if (backends.afplay) return this.spawnNotify([backends.afplay, file])
    if (backends.win) {
      return this.spawnNotify(
        [backends.win, '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', '(New-Object Media.SoundPlayer $env:DSH_WAV_PATH).PlaySync()'],
        { DSH_WAV_PATH: file },
      )
    }
    if (backends.paplay) return this.spawnNotify([backends.paplay, file])
    if (backends.aplay) return this.spawnNotify([backends.aplay, file])
    return false
  }

  private spawnNotify(argv: string[], env?: Record<string, string>): boolean {
    if (!this.subprocess) return false
    try {
      const handle = this.subprocess.spawn({
        argv,
        cwd: this.cwd,
        stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' },
        graceMs: 5000,
        env,
      })
      handle.done.catch(() => {})
      return true
    } catch {
      return false
    }
  }
}
