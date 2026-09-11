/** Host-only WAV transport; all filesystem operations stay in the subprocess execution world. */
import type SubprocessRuntime from '@deepseek-ai/dsh-subprocess'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { SOUNDS } from '../core/sounds.ts'
import { base64Encode, encodeWav, synthesize, volumeGain } from '../core/synth.ts'

export interface Backends {
  win: string | null
  sh: string | null
  afplay: string | null
  paplay: string | null
  aplay: string | null
}

type Writer = { executable: string; windows: boolean }
type Generation = { gain: number; writer: Writer }
type Directory = { writer: Writer; users: number; cleaning?: Promise<void> }
type Result = { ok: boolean; text: string | null }
type JobMode = 'work' | 'allocate' | 'cleanup'
const soundIds = new Set(SOUNDS.map(sound => sound.id))

function command(writer: Writer, script: string): string[] {
  return writer.windows
    ? [writer.executable, '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script]
    : [writer.executable, '-c', script]
}

// The allocator alone supplies these paths. Reject lossy/malformed output rather
// than risking deletion of a parent directory, relative path, or another root.
function allocatedPath(text: string | null): string | null {
  if (!text) return null
  const dir = text.replace(/\r?\n$/, '')
  if (/[\r\n\0]/.test(dir) || !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(dir)) return null
  if (dir.split(/[\\/]/).some(part => part === '.' || part === '..')) return null
  return /[\\/]dsh-next-notifier-[A-Za-z0-9]+$/.test(dir) ? dir : null
}

export class SoundDriver {
  private currentDir: string | null = null
  private currentGain: number | null = null
  private disposed = false
  private readonly lookupAbort = new AbortController()
  private pending: Generation | null = null
  private worker: Promise<string | null> | null = null
  private disposal: Promise<void> | null = null
  private readonly directories = new Map<string, Directory>()
  private readonly jobs = new Map<SubprocessHandle, { done: Promise<Result>; cancellable: boolean }>()
  // If a provider cannot prove tree exit, leaving temp files is safer than
  // removing files that an unobserved process could still be using.
  private unsafeToClean = false

  constructor(private readonly subprocess: SubprocessRuntime | undefined, private readonly cwd: string) {}

  get soundDir(): string | null { return this.currentDir }

  async detect(): Promise<Backends> {
    const [win, sh, afplay, paplay, aplay] = await Promise.all([
      this.resolve('powershell'), this.resolve('sh'), this.resolve('afplay'),
      this.resolve('paplay'), this.resolve('aplay'),
    ])
    return this.disposed ? { win: null, sh: null, afplay: null, paplay: null, aplay: null } : { win, sh, afplay, paplay, aplay }
  }

  private async resolve(cmd: string): Promise<string | null> {
    if (!this.subprocess || this.disposed) return null
    try {
      const path = await this.subprocess.resolveExecutable(cmd, undefined, this.lookupAbort.signal)
      return this.disposed ? null : path
    } catch {
      return null
    }
  }

  /** Serialize generation, retaining only the latest queued volume and the last good set. */
  ensureSounds(volume: number, backends: Backends): Promise<string | null> {
    if (this.disposed) return Promise.resolve(null)
    const executable = backends.win || backends.sh
    if (!this.subprocess || !executable || !Number.isFinite(volume)) return Promise.resolve(this.currentDir)
    const gain = volumeGain(volume)
    if (!this.worker && gain === this.currentGain && this.currentDir) return Promise.resolve(this.currentDir)
    this.pending = { gain, writer: { executable, windows: !!backends.win } }
    if (!this.worker) this.worker = this.generate()
    return this.worker
  }

  private async generate(): Promise<string | null> {
    try {
      while (this.pending && !this.disposed) {
        const { gain, writer } = this.pending
        this.pending = null
        if (gain === this.currentGain && this.currentDir) continue
        const allocation = await this.collect(command(writer, writer.windows
          ? "$ErrorActionPreference = 'Stop'; try { $dir = Join-Path ([IO.Path]::GetTempPath()) ('dsh-next-notifier-' + [Guid]::NewGuid().ToString('N')); New-Item -ItemType Directory -Path $dir -ErrorAction Stop | Out-Null; [Console]::Out.Write($dir) } catch { exit 1 }"
          : 'umask 077; cd "${TMPDIR:-/tmp}" || exit 1; root=$(pwd -P) || exit 1; d=$(mktemp -d "$root/dsh-next-notifier-XXXXXXXXXX") || exit 1; printf %s "$d"'), undefined, undefined, 'allocate')
        const dir = allocatedPath(allocation.text)
        if (!dir) continue
        // Remember even a late/cancelled allocation so disposal can reclaim it.
        this.directories.set(dir, { writer, users: 0 })
        if (allocation.ok && !this.disposed) {
          const written = await this.writeSounds(dir, gain, writer).catch(() => false)
          if (written && !this.disposed) {
            const previous = this.currentDir
            this.currentDir = dir
            this.currentGain = gain
            if (previous) await this.cleanup(previous)
            continue
          }
        }
        await this.cleanup(dir)
      }
      return this.currentDir
    } finally {
      // Clear synchronously before the worker settles; no request can land in
      // a promise-finalizer gap and be mistaken for an already drained update.
      this.worker = null
    }
  }

  private async writeSounds(dir: string, gain: number, writer: Writer): Promise<boolean> {
    let argv: string[]
    let data: string
    if (writer.windows) {
      // Wrap stdin in one script block: PowerShell -Command - otherwise treats
      // input as separate statements and can continue after a write error.
      const lines = ["& { $ErrorActionPreference = 'Stop'; try {"]
      for (const sound of SOUNDS) {
        const b64 = base64Encode(encodeWav(synthesize(sound, gain)))
        lines.push("[IO.File]::WriteAllBytes((Join-Path $env:DSH_NOTIFIER_DIR '" + sound.id + ".wav'), [Convert]::FromBase64String('" + b64 + "'))")
      }
      lines.push('} catch { exit 1 }; exit 0 }', '')
      data = lines.join('\n') + '\n'
      argv = command(writer, '-')
    } else {
      data = SOUNDS.map(sound => sound.id + '\n' + base64Encode(encodeWav(synthesize(sound, gain)))).join('\n') + '\n'
      argv = command(writer, 'cd "$DSH_NOTIFIER_DIR" || exit 1; while IFS= read -r name; do IFS= read -r b64 || exit 1; if ! printf %s "$b64" | base64 -d > "$name.wav" 2>/dev/null; then printf %s "$b64" | openssl base64 -d -A > "$name.wav" || exit 1; fi; done')
    }
    return (await this.collect(argv, data, { DSH_NOTIFIER_DIR: dir })).ok
  }

  private start(spec: SubprocessSpawnSpec, mode: JobMode = 'work'): Promise<Result> | null {
    if (!this.subprocess || (this.disposed && mode !== 'cleanup')) return null
    try {
      const handle = this.subprocess.spawn(spec)
      const done = this.observe(handle)
      this.jobs.set(handle, { done, cancellable: mode === 'work' })
      void done.then(() => { this.jobs.delete(handle) })
      return done
    } catch {
      return null
    }
  }

  private async observe(handle: SubprocessHandle): Promise<Result> {
    let ok = false
    let text: string | null = null
    try {
      const outcome = await handle.done
      ok = outcome.exitCode === 0 && outcome.signal === null
    } catch {
      // Spawn-level failure; still observe tree quiescence below.
    }
    try {
      if (!await handle.waitForExit()) this.unsafeToClean = true
    } catch {
      this.unsafeToClean = true
    }
    try {
      const read = handle.collected.stdout?.readFrom(0)
      if (read && !read.lossy) text = read.text
    } catch {
      // Missing or unreadable output cannot establish directory ownership.
    }
    return { ok: ok && !this.unsafeToClean, text }
  }

  private async collect(argv: string[], data?: string, env?: Record<string, string>, mode: JobMode = 'work'): Promise<Result> {
    return await this.start({
      argv, cwd: this.cwd, env,
      stdio: { stdin: data === undefined ? 'ignore' : { data }, stdout: { maxBytes: 8192 }, stderr: 'inherit' },
      graceMs: 1000,
    }, mode) ?? { ok: false, text: null }
  }

  private cleanup(dir: string): Promise<void> {
    const entry = this.directories.get(dir)
    if (!entry || entry.users || dir === this.currentDir || this.unsafeToClean) return Promise.resolve()
    if (!entry.cleaning) {
      entry.cleaning = (async () => {
        const result = await this.collect(command(entry.writer, entry.writer.windows
          ? "$ErrorActionPreference = 'Stop'; try { if (Test-Path -LiteralPath $env:DSH_NOTIFIER_DIR) { Remove-Item -LiteralPath $env:DSH_NOTIFIER_DIR -Recurse -Force }; exit 0 } catch { exit 1 }"
          : 'rm -rf -- "$DSH_NOTIFIER_DIR"'), undefined, { DSH_NOTIFIER_DIR: dir }, 'cleanup')
        if (result.ok) this.directories.delete(dir)
      })().finally(() => { entry.cleaning = undefined })
    }
    return entry.cleaning
  }

  /** True means playback was submitted, not that an asynchronous player exited successfully. */
  play(name: string, backends: Backends): boolean {
    if (this.disposed || !this.currentDir || !soundIds.has(name)) return false
    const dir = this.currentDir
    const file = dir + '/' + name + '.wav'
    if (backends.afplay) return this.spawnNotify(dir, [backends.afplay, file])
    if (backends.win) {
      return this.spawnNotify(dir,
        command({ executable: backends.win, windows: true }, '(New-Object Media.SoundPlayer $env:DSH_WAV_PATH).PlaySync()'),
        { DSH_WAV_PATH: file },
      )
    }
    if (backends.paplay) return this.spawnNotify(dir, [backends.paplay, file])
    if (backends.aplay) return this.spawnNotify(dir, [backends.aplay, file])
    return false
  }

  private spawnNotify(dir: string, argv: string[], env?: Record<string, string>): boolean {
    const entry = this.directories.get(dir)
    if (!entry) return false
    const done = this.start({
      argv, cwd: this.cwd, env,
      stdio: { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }, graceMs: 1000,
    })
    if (!done) return false
    entry.users++
    void done.then(async () => {
      entry.users--
      await this.cleanup(dir)
    })
    return true
  }

  /** Immediately disable use, then terminate owned trees and reclaim only owned directories. */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal
    this.disposed = true
    this.pending = null
    this.currentDir = null
    this.lookupAbort.abort()
    // A started allocator must finish its short ownership handoff: terminating
    // between mkdir and stdout would leave an unknowable directory behind.
    // Writers/players are cancelled; allocation and cleanup are awaited.
    const jobs = [...this.jobs]
    for (const [handle, job] of jobs) {
      if (job.cancellable) {
        try { handle.terminate() } catch { this.unsafeToClean = true }
      }
    }
    this.disposal = (async () => {
      await Promise.all([this.worker, ...jobs.map(([, job]) => job.done)])
      await Promise.all([...this.directories.keys()].map(dir => this.cleanup(dir)))
    })()
    return this.disposal
  }
}
