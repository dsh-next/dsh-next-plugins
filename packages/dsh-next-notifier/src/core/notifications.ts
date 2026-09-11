/** Shared notification identity and delivery protocol. No runtime dependencies. */
export type EventKind = 'finished' | 'approval' | 'question' | 'subagent' | 'goal-complete' | 'goal-blocked' | 'error' | 'blocked' | 'max-tokens'
export type GroupKey = 'finished' | 'approval' | 'question'

export interface NotificationEvent {
  kind: EventKind
  group: GroupKey
  title: string
  body: string
  sessionId: string
  /** Retain origin when a child failure uses an error kind. */
  isSubagent?: boolean
}

export type WebPermission = 'granted' | 'denied' | 'default' | 'unsupported'
export interface ClientPresence {
  clientId: string
  sequence: number
  focused: boolean
  visible: boolean
  open: boolean
  sessionId: string | null
  permission: WebPermission
}

export interface Delivery extends Omit<NotificationEvent, 'group'> {
  id: string
  at: number
  lease: string
  leaseExpiresAt: number
}

export interface DeliveryReceipt {
  clientId: string
  id: string
  lease: string
}
