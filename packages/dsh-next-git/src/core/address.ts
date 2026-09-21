/**
 * The `dsh-resource://file/...` address the panel hands to the stock text
 * viewer when the user opens a changed file.
 *
 * The platform's own file provider owns this grammar; the plugin only builds
 * the address, so no import crosses the package boundary (see the retired
 * plugin's `openFile` handoff and `dsh-client-ui-sidebar-documentpreview`).
 */

/** Scheme and resource type every file address opens with. */
export const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** Component-encode one path or id segment, keeping a drive letter's `:` literal. */
export function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/** Encode a `/`-separated path, segment by segment. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/')
}

/**
 * Build the address of a file read through one session.
 *
 * @param sessionId - the session whose workspace resolves the path.
 * @param path - absolute or repository-relative path; backslashes are
 * normalized and a leading `./` is dropped.
 * @returns the `dsh-resource://file/session/<id>/<path>` address.
 */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`
}

/**
 * Whether an address is one this plugin builds.
 *
 * @param address - any address string.
 * @returns whether it is a file address.
 */
export function isFileAddress(address: string): boolean {
  return address.startsWith(FILE_ADDRESS_PREFIX)
}

/**
 * The scheme-typed address of this plugin's own change view.
 *
 * The platform's resource model leaves a protocol's grammar to its owner, and
 * this plugin owns `git-changes`: the tab that reads a whole changed file with
 * its changed lines marked. The session is part of the address for the same
 * reason the stock file viewer keeps it there — the tab keeps meaning while the
 * pane shows another session.
 */
export const CHANGES_ADDRESS_PREFIX = 'dsh-resource://git-changes/'

/**
 * Build the change-view address of one changed path.
 *
 * @param sessionId - the session whose workspace resolves the repository.
 * @param path - repository-relative path.
 * @param side - which side of the index the view shows.
 * @returns `dsh-resource://git-changes/session/<id>/<side>/<path>`.
 */
export function changeFileAddress(sessionId: string, path: string, side: 'staged' | 'unstaged'): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  return `${CHANGES_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${side}/${encodePath(normalized)}`
}

/**
 * Read one change-view address back.
 *
 * @param address - any address string.
 * @returns the parsed parts, or null when this is not one of ours.
 */
export function parseChangeFileAddress(
  address: string,
): { sessionId: string; side: 'staged' | 'unstaged'; path: string } | null {
  if (!address.startsWith(CHANGES_ADDRESS_PREFIX)) return null
  const rest = address.slice(CHANGES_ADDRESS_PREFIX.length)
  const parts = rest.split('/')
  const [scope, session, side, ...path] = parts
  if (scope !== 'session' || session === undefined || side === undefined || path.length === 0) return null
  if (side !== 'staged' && side !== 'unstaged') return null
  const decoded = path.map(segment => {
    try {
      return decodeURIComponent(segment)
    } catch {
      return null
    }
  })
  if (decoded.some(segment => segment === null || segment === '')) return null
  return { sessionId: decodeURIComponent(session), side, path: decoded.join('/') }
}

/** The last path segment of an address, decoded, for a tab chip. */
export function changeFileTitle(address: string): string {
  const parsed = parseChangeFileAddress(address)
  if (parsed === null) return address
  const name = parsed.path.slice(parsed.path.lastIndexOf('/') + 1)
  return parsed.side === 'staged' ? `${name} (staged)` : name
}

/** Normalize separators and collapse `.` / `..` segments. */
export function normalizePosix(path: string): string {
  const parts: string[] = []
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return `${path.startsWith('/') ? '/' : ''}${parts.join('/')}`
}

/**
 * The workspace-relative path a repository-relative path opens as.
 *
 * Status and diff paths are relative to the repository root, while the file
 * provider resolves against the session's workspace directory. When the repo
 * root sits inside the workspace the path is rebased; otherwise the absolute
 * form is used, which the same provider accepts.
 *
 * @param cwd - the session's working directory.
 * @param root - the repository root.
 * @param path - the repository-relative path.
 * @returns `{ kind: 'relative', path }` or `{ kind: 'absolute', path }`.
 */
export function workspacePathFor(
  cwd: string,
  root: string,
  path: string,
): { kind: 'relative'; path: string } | { kind: 'absolute'; path: string } {
  const normalizedCwd = normalizePosix(cwd)
  const normalizedRoot = normalizePosix(root)
  const absolute = normalizePosix(`${normalizedRoot}/${path}`)
  if (normalizedCwd !== '' && (absolute === normalizedCwd || absolute.startsWith(`${normalizedCwd}/`))) {
    return { kind: 'relative', path: absolute.slice(normalizedCwd.length + 1) }
  }
  return { kind: 'absolute', path: absolute }
}

/**
 * The address of a file the session's workspace resolves.
 *
 * @param sessionId - the session whose workspace owns the file.
 * @param target - the result of {@link workspacePathFor}.
 * @returns the `dsh-resource://file/...` address.
 */
export function targetFileAddress(
  sessionId: string,
  target: { kind: 'relative'; path: string } | { kind: 'absolute'; path: string },
): string {
  if (target.kind === 'relative') return sessionFileAddress(sessionId, target.path)
  // Absolute addresses are scheme-rooted: the leading separator belongs to the
  // address, not to the first path segment.
  return `${FILE_ADDRESS_PREFIX}absolute/${encodePath(target.path.replace(/^\/+/, ''))}`
}
