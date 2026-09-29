/** Host owns policy and leased delivery; presentation and sound belong to the client. */
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigScope } from './config-scope.ts'
import type { NotifierConfig } from '../core/types.ts'
import type { ClientPresence, DeliveryReceipt } from '../core/notifications.ts'
import type { TimerLike } from '../core/timer.ts'
import { normalizeConfig } from '../core/config.ts'
import { SOUNDS } from '../core/sounds.ts'
import { DeliveryBroker } from './delivery-broker.ts'
import { wireEvents, type EventOptions } from './events.ts'

export interface NotifierOptions {
  ctx: Context
  scope: ConfigScope | null
  timer: TimerLike
  goals: EventOptions['goals']
}

export class Notifier {
  private readonly broker = new DeliveryBroker(() => this.config())
  private offEvents: (() => void) | null = null
  private disposed = false
  constructor(private readonly opts: NotifierOptions) {}

  config(): NotifierConfig { return normalizeConfig(this.opts.scope?.get()) }
  state(clientId = '') {
    return {
      config: this.config(),
      webPermission: this.broker.presence(clientId).permission,
      sounds: SOUNDS.map(({ id, name, group }) => ({ id, name, group })),
    }
  }
  reportPresence(report: ClientPresence): void { this.broker.report(report) }
  getPresence(clientId: string) { return this.broker.presence(clientId) }
  claimPending(clientId: string) { return this.broker.claim(clientId) }
  release(receipt: DeliveryReceipt): void { this.broker.release(receipt) }
  acknowledge(receipt: DeliveryReceipt): { ok: boolean; sound?: { id: string; volume: number } } {
    const event = !this.disposed && this.broker.ack(receipt)
    if (!event) return { ok: false }
    const config = this.config()
    const group = config[event.group]
    return { ok: true, ...(group.sound && config.volume > 0
      ? { sound: { id: group.soundName, volume: config.volume } } : {}) }
  }
  wire(): void {
    if (this.disposed || this.offEvents) return
    this.offEvents = wireEvents({ ctx: this.opts.ctx, timer: this.opts.timer, goals: this.opts.goals,
      config: () => this.config(), publish: (event) => this.broker.publish(event) })
  }
  dispose(): void {
    this.disposed = true
    this.offEvents?.()
    this.offEvents = null
    this.broker.dispose()
  }
}
