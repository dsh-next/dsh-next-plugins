/** Host composition: event policy, owned delivery, and the sound backend. */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import type { NotifierConfig } from '../core/types.ts'
import type { ClientPresence, DeliveryReceipt } from '../core/notifications.ts'
import type { TimerLike } from '../core/timer.ts'
import { normalizeConfig } from '../core/config.ts'
import { SOUNDS } from '../core/sounds.ts'
import { SoundDriver, type Backends } from './sound-driver.ts'
import { DeliveryBroker } from './delivery-broker.ts'
import { wireEvents, type EventOptions } from './events.ts'

export interface NotifierOptions {
  ctx: Context
  scope: SettingsScope<NotifierConfig> | null
  timer: TimerLike
  goals: EventOptions['goals']
}

export class Notifier {
  private backends: Backends = { win: null, sh: null, afplay: null, paplay: null, aplay: null }
  private readonly driver: SoundDriver
  private readonly broker = new DeliveryBroker(() => this.config())
  private offEvents: (() => void) | null = null
  private disposed = false

  constructor(private readonly opts: NotifierOptions) {
    this.driver = new SoundDriver(opts.ctx.get('subprocess'), opts.ctx.get('sandboxPolicy')?.workspaceRoot ?? '.')
  }

  config(): NotifierConfig { return normalizeConfig(this.opts.scope?.get()) }

  state(clientId = '') {
    return {
      config: this.config(),
      platform: this.backends.afplay ? 'macos' : this.backends.win ? 'windows' : this.backends.paplay || this.backends.aplay ? 'linux' : null,
      webPermission: this.broker.presence(clientId).permission,
      sounds: SOUNDS.map(({ id, name, group }) => ({ id, name, group })),
    }
  }

  async start(): Promise<void> {
    const backends = await this.driver.detect()
    if (this.disposed) return
    this.backends = backends
    await this.onConfigChanged()
  }

  async onConfigChanged(): Promise<void> {
    if (!this.disposed) await this.driver.ensureSounds(this.config().volume, this.backends)
  }

  async preview(id: string): Promise<boolean> {
    await this.onConfigChanged()
    return !this.disposed && this.driver.play(id, this.backends)
  }

  reportPresence(report: ClientPresence): void { this.broker.report(report) }
  getPresence(clientId: string) { return this.broker.presence(clientId) }
  claimPending(clientId: string) { return this.broker.claim(clientId) }
  release(receipt: DeliveryReceipt): void { this.broker.release(receipt) }

  acknowledge(receipt: DeliveryReceipt): boolean {
    const event = this.broker.ack(receipt)
    if (!event || this.disposed) return false
    const config = this.config()
    const group = config[event.group]
    // Never sound on enqueue or failed rendering. A lease can be acknowledged
    // only once, even when an HTTP response is lost and the client retries.
    if (group.sound && config.volume > 0) this.driver.play(group.soundName, this.backends)
    return true
  }

  wire(): void {
    if (this.disposed || this.offEvents) return
    this.offEvents = wireEvents({ ctx: this.opts.ctx, timer: this.opts.timer, goals: this.opts.goals,
      config: () => this.config(), publish: (event) => this.broker.publish(event) })
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.offEvents?.()
    this.offEvents = null
    this.broker.dispose()
    await this.driver.dispose()
  }
}
