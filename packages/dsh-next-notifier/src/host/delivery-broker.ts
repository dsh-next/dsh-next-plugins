/** Own client presence and lease alerts until a renderer acknowledges delivery. */
import { randomUUID } from 'node:crypto'
import type { NotifierConfig } from '../core/types.ts'
import type { ClientPresence, Delivery, DeliveryReceipt, NotificationEvent } from '../core/notifications.ts'
import { decide } from '../core/decision.ts'

// Hidden Chromium tabs may only run timers once per minute. A closed report
// removes a client immediately; expiry also handles crashed/disconnected tabs.
const CLIENT_TTL = 120000
const FOCUS_TTL = 10000
const EVENT_TTL = 120000
const LEASE_TTL = 10000
const MAX_PENDING = 100
const MAX_CLIENTS = 100
interface Client { report: ClientPresence; at: number; retryAt: number }
interface Pending {
  event: NotificationEvent
  at: number
  lease?: { token: string; clientId: string; until: number }
}

export class DeliveryBroker {
  private clients = new Map<string, Client>()
  private pending = new Map<string, Pending>()
  private disposed = false

  constructor(private readonly config: () => NotifierConfig, private readonly now = Date.now) {}

  report(report: ClientPresence): void {
    if (this.disposed) return
    this.prune()
    const previous = this.clients.get(report.clientId)
    if (previous && report.sequence <= previous.report.sequence) return
    if (!previous && this.clients.size >= MAX_CLIENTS) return
    const changed = !previous || previous.report.focused !== report.focused
      || previous.report.visible !== report.visible || previous.report.permission !== report.permission
    this.clients.set(report.clientId, { report: { ...report }, at: this.now(), retryAt: changed ? 0 : previous.retryAt })
    if (!report.open) {
      if (this.liveClients().length === 0) this.pending.clear()
      for (const pending of this.pending.values()) {
        if (pending.lease?.clientId === report.clientId) delete pending.lease
      }
    }
  }

  presence(clientId: string) {
    this.prune()
    const client = this.clients.get(clientId)
    return {
      focused: client?.report.focused ?? false,
      visible: client?.report.visible ?? false,
      sessionId: client?.report.sessionId ?? null,
      ageMs: client ? this.now() - client.at : null,
      permission: client?.report.permission ?? null,
    }
  }

  publish(event: NotificationEvent): () => void {
    this.prune()
    if (this.disposed || !this.allowed(event)) return () => {}
    const id = randomUUID()
    this.pending.set(id, { event: { ...event }, at: this.now() })
    if (this.pending.size > MAX_PENDING) this.pending.delete(this.pending.keys().next().value!)
    return () => { this.pending.delete(id) }
  }

  claim(clientId: string): Delivery[] {
    this.prune()
    if (this.disposed) return []
    const clients = this.liveClients().filter(c => c.retryAt <= this.now())
    const claimant = clients.find(c => c.report.clientId === clientId)
    if (!claimant) return []
    // Any eligible focused client can claim. Background clients yield to fresh
    // focused viewers; the per-event lease, not a sticky global election, owns
    // delivery. An abandoned tab therefore cannot monopolize every event.
    if (clients.some(c => this.looking(c))) {
      if (!this.looking(claimant)) return []
    } else if (claimant.report.permission !== 'granted') return []
    for (const [id, pending] of this.pending) {
      if (!this.allowed(pending.event)) { this.pending.delete(id); continue }
      if (pending.lease && pending.lease.until > this.now()) continue
      const token = randomUUID()
      pending.lease = { token, clientId, until: this.now() + LEASE_TTL }
      const { group: _group, ...event } = pending.event
      // One event per poll ensures its toast commits before another replaces it.
      return [{ ...event, id, at: pending.at, lease: token, leaseExpiresAt: pending.lease.until }]
    }
    return []
  }

  ack(receipt: DeliveryReceipt): NotificationEvent | null {
    this.prune()
    const pending = this.match(receipt)
    if (!pending) return null
    this.pending.delete(receipt.id)
    return this.allowed(pending.event) ? pending.event : null
  }

  release(receipt: DeliveryReceipt): void {
    const pending = this.match(receipt)
    if (pending) {
      delete pending.lease
      const client = this.clients.get(receipt.clientId)
      if (client) client.retryAt = this.now() + LEASE_TTL
    }
  }

  dispose(): void {
    this.disposed = true
    this.pending.clear()
    this.clients.clear()
  }

  private match(receipt: DeliveryReceipt): Pending | undefined {
    const pending = this.pending.get(receipt.id)
    return pending?.lease?.clientId === receipt.clientId
      && pending.lease.token === receipt.lease && pending.lease.until > this.now() ? pending : undefined
  }

  private liveClients(): Client[] {
    return [...this.clients.values()].filter((c) => c.report.open && this.now() - c.at <= CLIENT_TTL)
  }

  private looking(client: Client): boolean {
    return client.report.focused && client.report.visible && this.now() - client.at <= FOCUS_TTL
  }

  private allowed(event: NotificationEvent): boolean {
    const clients = this.liveClients()
    const client = clients.find((c) => this.looking(c) && c.report.sessionId === event.sessionId)
      ?? clients.find((c) => this.looking(c)) ?? clients[0]
    const config = this.config()
    if (event.isSubagent && !config.finished.subagent) return false
    const decision = decide({ config, presence: client ? { ...client.report, focused: this.looking(client) } : null, presenceAgeMs: client ? this.now() - client.at : Infinity,
      eventKind: event.kind, title: event.title, body: event.body, sessionId: event.sessionId,
      viewingAtEvent: true, group: event.group, subagentEnabled: config.finished.subagent }, CLIENT_TTL, client?.report.permission ?? null)
    // Missing web permission is a delivery constraint, not an instruction to
    // lose the event: retain it for a foreground toast until EVENT_TTL.
    return decision.notify || decision.reason === 'permission-missing'
  }

  private prune(): void {
    const now = this.now()
    for (const [id, client] of this.clients) if (now - client.at > CLIENT_TTL) this.clients.delete(id)
    for (const [id, event] of this.pending) if (now - event.at > EVENT_TTL) this.pending.delete(id)
  }
}
