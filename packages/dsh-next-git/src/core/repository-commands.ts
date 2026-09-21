/** JSON-only contracts for explicitly approved host repository commands. */
export type RepositoryCommandRequest =
  | { action: 'pull'; remote: string; branch: string; rebase: boolean }
  | { action: 'sync'; remote: string; branch: string }
  | { action: 'push-force'; remote: string; branch: string }
  | { action: 'fetch-all'; prune: boolean }
  | { action: 'publish'; remote: string; branch: string }
  | { action: 'merge' | 'rebase'; ref: string }
  | { action: 'remote-add'; name: string; url: string }
  | { action: 'remote-remove'; remote: string }
  | { action: 'remote-branch-delete'; remote: string; branch: string }
  | { action: 'tag-create'; name: string; ref: string; message: string }
  | { action: 'tag-delete'; tag: string }
  | { action: 'remote-tag-delete'; remote: string; tag: string }
  | { action: 'tags-push'; remote: string }
  | { action: 'stash-staged'; message: string }
  | { action: 'stash-pop' | 'stash-drop'; stashOid: string }
  | { action: 'stash-clear' }
  | { action: 'undo-commit' }
  | { action: 'clone'; url: string; directory: string }

export interface RepositoryCommandPreview {
  readonly version: string
  readonly request: RepositoryCommandRequest
  readonly checkout: string
  readonly head: string | null
  readonly summary: string
  readonly warnings: readonly string[]
}
export interface RepositoryCommandExecution {
  readonly request: RepositoryCommandRequest
  readonly version: string
  readonly approved: true
}
export interface RepositoryStashInspection { readonly stashOid: string; readonly patch: string }
export interface RepositoryCommandOutput { readonly text: string }

const shapes: Record<string, Record<string, 'string' | 'boolean'>> = {
  pull: { remote: 'string', branch: 'string', rebase: 'boolean' },
  sync: { remote: 'string', branch: 'string' },
  'push-force': { remote: 'string', branch: 'string' },
  'fetch-all': { prune: 'boolean' },
  publish: { remote: 'string', branch: 'string' },
  merge: { ref: 'string' }, rebase: { ref: 'string' },
  'remote-add': { name: 'string', url: 'string' }, 'remote-remove': { remote: 'string' },
  'remote-branch-delete': { remote: 'string', branch: 'string' },
  'tag-create': { name: 'string', ref: 'string', message: 'string' },
  'tag-delete': { tag: 'string' }, 'remote-tag-delete': { remote: 'string', tag: 'string' },
  'tags-push': { remote: 'string' }, 'stash-staged': { message: 'string' },
  'stash-pop': { stashOid: 'string' }, 'stash-drop': { stashOid: 'string' },
  'stash-clear': {}, 'undo-commit': {}, clone: { url: 'string', directory: 'string' },
}

/** Refuse unknown actions, missing fields, extras, non-JSON objects and coercion. */
export function parseRepositoryCommand(input: unknown): RepositoryCommandRequest {
  const invalid = (): never => { throw new Error('Invalid repository command request.') }
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return invalid()
  const proto = Object.getPrototypeOf(input)
  if (proto !== Object.prototype && proto !== null) return invalid()
  const value = input as Record<string, unknown>
  if (typeof value.action !== 'string' || !Object.hasOwn(shapes, value.action)) return invalid()
  const shape = shapes[value.action]!
  if (Reflect.ownKeys(value).length !== Object.keys(shape).length + 1) return invalid()
  const parsed: Record<string, unknown> = { action: value.action }
  for (const [key, type] of Object.entries(shape)) {
    if (!Object.hasOwn(value, key) || typeof value[key] !== type) return invalid()
    if (type === 'string' && ((value[key] as string).length > 4096 || (value[key] as string).includes('\0'))) return invalid()
    parsed[key] = value[key]
  }
  return parsed as RepositoryCommandRequest
}
