import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const strings = (value) => Array.isArray(value) && value.every((item) => typeof item === 'string')

function validateRegistry(doc) {
  const invalid = (field) => { throw new Error(`invalid workspace registry shape: ${field}`) }
  if (!object(doc)) invalid('root')
  if (!object(doc.unit) || doc.unit.name !== 'workspace' || doc.unit.version !== 2) invalid('unit (expected workspace version 2)')
  if (!object(doc.global) || !strings(doc.global.workspaceIds)) invalid('global.workspaceIds')
  if ('initialized' in doc.global && typeof doc.global.initialized !== 'boolean') invalid('global.initialized')
  if ('archivedSessionIds' in doc.global && !strings(doc.global.archivedSessionIds)) invalid('global.archivedSessionIds')
  if (!object(doc.tables) || !object(doc.tables.workspaces)) invalid('tables.workspaces')
  for (const [id, record] of Object.entries(doc.tables.workspaces)) {
    if (!object(record) || typeof record.path !== 'string' || record.path.length === 0) invalid(`workspaces.${id}.path`)
    for (const field of ['title', 'createdAt', 'updatedAt']) {
      if (field in record && typeof record[field] !== 'string') invalid(`workspaces.${id}.${field}`)
    }
    if ('sessionIds' in record && !strings(record.sessionIds)) invalid(`workspaces.${id}.sessionIds`)
  }
}

function loadRegistry(file) {
  let metadata
  try {
    metadata = lstatSync(file)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return {
      doc: {
        unit: { name: 'workspace', version: 2 },
        global: { initialized: true, workspaceIds: [], archivedSessionIds: [] },
        tables: { workspaces: {} },
      },
      mode: 0o600,
    }
  }
  // Refuse links rather than replacing a link or treating a dangling link as absent.
  if (!metadata.isFile()) throw new Error(`registry is not a regular file: ${file}`)
  const doc = JSON.parse(readFileSync(file, 'utf8'))
  validateRegistry(doc)
  return { doc, mode: metadata.mode & 0o777 }
}

function writeRegistry(file, doc, mode) {
  mkdirSync(dirname(file), { recursive: true })
  // Same-filesystem rename publishes only complete JSON. This is NOT a lock: the
  // scratch runtime must be stopped, with no other writers, throughout seeding.
  const temporary = mkdtempSync(join(dirname(file), '.workspace-seed-'))
  try {
    const pending = join(temporary, 'workspace.json')
    const fd = openSync(pending, 'wx', mode)
    try {
      writeFileSync(fd, JSON.stringify(doc, null, 2) + '\n')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(pending, file)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/**
 * Seed a STOPPED scratch runtime; never call while DSH or another writer runs.
 * Returns { added, registered, file }; throws on failure. Validation and staging
 * failures leave the registry untouched. Atomic replacement is not a lock.
 * Existing records/unknown fields survive, and a no-op never rewrites the file.
 */
export function seedWorkspaces(home, directories) {
  if (typeof home !== 'string' || home.length === 0 || !Array.isArray(directories) ||
      directories.length === 0 || directories.some((dir) => typeof dir !== 'string' || dir.length === 0)) {
    throw new Error('usage: e2e-seed-workspaces.sh <DSH_HOME> <workspace-dir> [more-dirs...]')
  }
  const file = resolve(home, 'storages', 'workspace.json')
  const { doc, mode } = loadRegistry(file)
  // Validate the entire input before publishing anything, including on no-op runs.
  const paths = directories.map((dir) => {
    const path = realpathSync(dir)
    if (!statSync(path).isDirectory()) throw new Error(`workspace is not a directory: ${dir}`)
    return path
  })
  const byPath = new Map(Object.entries(doc.tables.workspaces).map(([id, record]) => [record.path, id]))
  let added = 0
  for (const path of paths) {
    if (byPath.has(path)) continue
    const now = new Date().toISOString()
    // Keep the original deterministic uuid-shaped ids stable across upgrades.
    const h = createHash('sha1').update(`dsh-next-e2e-workspace:${path}`).digest('hex')
    const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
    if (Object.hasOwn(doc.tables.workspaces, id) || doc.global.workspaceIds.includes(id)) {
      throw new Error(`workspace id collision: ${id}`)
    }
    doc.tables.workspaces[id] = { path, title: basename(path), sessionIds: [], createdAt: now, updatedAt: now }
    doc.global.workspaceIds.push(id)
    byPath.set(path, id)
    added += 1
  }
  if (added > 0) writeRegistry(file, doc, mode)
  return { added, registered: byPath.size, file }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { added, registered, file } = seedWorkspaces(process.argv[2], process.argv.slice(3))
    console.log(`e2e-seed-workspaces: ${added} added, ${registered} registered in ${file}`)
  } catch (error) {
    console.error(`e2e-seed-workspaces: ${error.message}`)
    process.exitCode = 1
  }
}
