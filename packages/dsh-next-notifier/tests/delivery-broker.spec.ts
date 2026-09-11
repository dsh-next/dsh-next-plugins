import { describe, expect, it } from 'vitest'
import { DeliveryBroker } from '../src/host/delivery-broker.ts'
import { defaultConfig } from '../src/core/config.ts'
import type { ClientPresence, NotificationEvent } from '../src/core/notifications.ts'

const event: NotificationEvent = { kind: 'finished', group: 'finished', title: 'Agent finished', body: 'Done', sessionId: 'agent' }
const report = (clientId: string, overrides: Partial<ClientPresence> = {}): ClientPresence => ({ clientId, sequence: 1, focused: true, visible: true, open: true, sessionId: 'other', permission: 'denied', ...overrides })
function setup() {
  let now = 1000
  const config = defaultConfig()
  const broker = new DeliveryBroker(() => config, () => now)
  return { broker, config, advance: (ms: number) => { now += ms } }
}

describe('DeliveryBroker', () => {
  it('does not let background tabs override a viewer or close another page', () => {
    const { broker } = setup()
    broker.report(report('a', { sessionId: 'agent' }))
    broker.report(report('b', { focused: false, visible: false, permission: 'granted' }))
    broker.publish(event)
    expect(broker.claim('b')).toEqual([])
    expect(broker.claim('a')).toEqual([])
    broker.report(report('b', { sequence: 2, open: false }))
    broker.publish({ ...event, sessionId: 'different' })
    expect(broker.claim('a')).toHaveLength(1)
  })
  it('leases to the focused owner, not whichever tab polls first', () => {
    const { broker } = setup()
    broker.report(report('a'))
    broker.report(report('b', { focused: false, visible: false, permission: 'granted' }))
    broker.publish(event)
    expect(broker.claim('b')).toEqual([])
    const [delivery] = broker.claim('a')
    expect(delivery.sessionId).toBe('agent')
    expect(broker.claim('a')).toEqual([])
    expect(broker.ack({ clientId: 'b', id: delivery.id, lease: delivery.lease })).toBeNull()
    expect(broker.ack({ clientId: 'a', id: delivery.id, lease: delivery.lease })).toEqual(event)
    expect(broker.ack({ clientId: 'a', id: delivery.id, lease: delivery.lease })).toBeNull()
  })
  it('retains failed deliveries and permits foreground retry without permission', () => {
    const { broker } = setup()
    broker.report(report('a'))
    broker.publish(event)
    const [delivery] = broker.claim('a')
    broker.release({ clientId: 'a', id: delivery.id, lease: delivery.lease })
    broker.report(report('a', { sequence: 2, focused: false }))
    expect(broker.claim('a')).toEqual([])
    broker.report(report('a', { sequence: 3 }))
    expect(broker.claim('a')).toHaveLength(1)
  })
  it('fails over to another background client after renderer failure', () => {
    const { broker } = setup()
    broker.report(report('a', { focused: false, visible: false, permission: 'granted' }))
    broker.report(report('b', { focused: false, visible: false, permission: 'granted' }))
    broker.publish(event)
    const [first] = broker.claim('a')
    broker.release({ clientId: 'a', id: first.id, lease: first.lease })
    broker.report(report('a', { sequence: 2, focused: false, visible: false, permission: 'granted' }))
    expect(broker.claim('a')).toEqual([])
    expect(broker.claim('b')[0].id).toBe(first.id)
  })
  it('retains child origin when a failure uses the error category', () => {
    const { broker, config } = setup()
    broker.report(report('a'))
    config.finished.subagent = true
    broker.publish({ ...event, kind: 'error', isSubagent: true })
    config.finished.subagent = false
    expect(broker.claim('a')).toEqual([])
  })
  it('rejects stale reports including close reports', () => {
    const { broker } = setup()
    broker.report(report('a', { sequence: 3 }))
    broker.report(report('a', { sequence: 2, open: false }))
    broker.publish(event)
    expect(broker.claim('a')).toHaveLength(1)
  })
  it('releases lost leases but rejects late acknowledgements', () => {
    const { broker, advance } = setup()
    broker.report(report('a'))
    broker.publish(event)
    const [first] = broker.claim('a')
    advance(10001)
    broker.report(report('a', { sequence: 2 }))
    const [second] = broker.claim('a')
    expect(second.id).toBe(first.id)
    expect(second.lease).not.toBe(first.lease)
    expect(broker.ack({ clientId: 'a', id: first.id, lease: first.lease })).toBeNull()
    expect(broker.ack({ clientId: 'a', id: second.id, lease: second.lease })).toEqual(event)
  })
  it('drops expired events and requires recent open clients', () => {
    const { broker, advance } = setup()
    broker.publish(event)
    broker.report(report('a'))
    expect(broker.claim('a')).toEqual([])
    broker.publish(event)
    advance(120001)
    broker.report(report('a', { sequence: 2 }))
    expect(broker.claim('a')).toEqual([])
  })
  it('rechecks master/group/subagent switches and viewing state before delivery', () => {
    for (const mode of ['master', 'group', 'viewing', 'subagent'] as const) {
      const { broker, config } = setup()
      broker.report(report('a'))
      config.finished.subagent = true
      broker.publish(mode === 'subagent' ? { ...event, kind: 'subagent' } : event)
      if (mode === 'master') config.enabled = false
      if (mode === 'group') config.finished.enabled = false
      if (mode === 'viewing') broker.report(report('a', { sequence: 2, sessionId: 'agent' }))
      if (mode === 'subagent') config.finished.subagent = false
      expect(broker.claim('a')).toEqual([])
    }
  })
  it('cancels pending requests, including leased acknowledgements', () => {
    const { broker } = setup()
    broker.report(report('a'))
    const cancel = broker.publish({ ...event, kind: 'approval', group: 'approval' })
    const [delivery] = broker.claim('a')
    cancel()
    expect(broker.ack({ clientId: 'a', id: delivery.id, lease: delivery.lease })).toBeNull()
    expect(broker.claim('a')).toEqual([])
  })
  it('does not let an abandoned client monopolize a fresh focused or background renderer', () => {
    for (const focused of [true, false]) {
      const { broker } = setup()
      broker.report(report('abandoned', { focused, visible: focused, permission: 'granted' }))
      broker.report(report('fresh', { focused, visible: focused, permission: 'granted' }))
      broker.publish(event)
      expect(broker.claim('fresh')).toHaveLength(1)
    }
  })
  it('expires stale viewing suppression before background-page liveness', () => {
    const { broker, advance } = setup()
    broker.report(report('abandoned', { sessionId: 'agent' }))
    advance(10001)
    broker.report(report('fresh'))
    broker.publish(event)
    expect(broker.claim('fresh')).toHaveLength(1)
  })
  it('does not deliver old alerts after every page was closed', () => {
    const { broker } = setup()
    broker.report(report('a'))
    broker.publish(event)
    broker.report(report('a', { sequence: 2, open: false }))
    broker.report(report('b'))
    expect(broker.claim('b')).toEqual([])
  })
  it('bounds the queue and clears clients/events on disposal', () => {
    const { broker } = setup()
    broker.report(report('a'))
    for (let i = 0; i < 110; i++) broker.publish(event)
    let count = 0
    for (let delivery = broker.claim('a')[0]; delivery; delivery = broker.claim('a')[0]) {
      broker.ack({ clientId: 'a', id: delivery.id, lease: delivery.lease })
      count++
    }
    expect(count).toBe(100)
    broker.dispose()
    expect(broker.claim('a')).toEqual([])
    expect(broker.presence('a').ageMs).toBeNull()
    broker.report(report('a', { sequence: 2 }))
    broker.publish(event)
    expect(broker.claim('a')).toEqual([])
  })
})
