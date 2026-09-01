#!/usr/bin/env bash
# Register directories as DSH workspaces in a home's storage registry —
# the reusable e2e seeding step (also usable on dev-profile homes).
#
# Usage: e2e-seed-workspaces.sh <DSH_HOME> <workspace-dir> [more-dirs...]
#
# Behavior:
#  - Idempotent: merges into $DSH_HOME/storages/workspace.json keyed by the
#    canonical (realpath) directory; existing registrations are never
#    modified or removed, so the script is safe to re-run on any home.
#  - Deterministic workspace ids derived from the canonical path, so
#    repeated runs keep ids stable.
#  - Titles default to the directory base name.
#  - Paths are canonicalized before storing: the workspace plugin resolves
#    realpaths, and on macOS a /tmp scratch dir is really /private/tmp/...,
#    so callers must use the same canonical path when asserting on disk.
#
# scripts/e2e-mount.sh seeds two scratch workspaces through this script and
# exports their canonical paths (DSH_E2E_WORKSPACE_A / _B) to the specs, so
# every plugin's DOM marker can drive workspace-scoped flows without any
# hardcoded machine paths.

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <DSH_HOME> <workspace-dir> [more-dirs...]" >&2
  exit 1
fi

DSH_SEED_HOME=$1
shift
DSH_SEED_DIRS=$*
export DSH_SEED_HOME DSH_SEED_DIRS

exec node <<'EOF'
const { createHash } = require('node:crypto')
const { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } = require('node:fs')
const { basename, join } = require('node:path')

const home = process.env.DSH_SEED_HOME
const dirs = process.env.DSH_SEED_DIRS.split(' ').map((d) => d.trim()).filter(Boolean)
if (dirs.length === 0) {
  console.error('e2e-seed-workspaces: no workspace directories given')
  process.exit(1)
}

const file = join(home, 'storages', 'workspace.json')
let doc = {
  unit: { name: 'workspace', version: 2 },
  global: { initialized: true, workspaceIds: [], archivedSessionIds: [] },
  tables: { workspaces: {} },
}
if (existsSync(file)) {
  try {
    doc = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    console.error(`e2e-seed-workspaces: ${file} is corrupt; recreating`)
  }
}
doc.global ??= { initialized: true, workspaceIds: [], archivedSessionIds: [] }
doc.global.workspaceIds ??= []
doc.global.archivedSessionIds ??= []
doc.tables ??= {}
doc.tables.workspaces ??= {}

const byPath = new Map(Object.entries(doc.tables.workspaces).map(([id, record]) => [record.path, id]))
let added = 0
for (const dir of dirs) {
  if (!existsSync(dir)) {
    console.error(`e2e-seed-workspaces: workspace directory does not exist: ${dir}`)
    process.exit(1)
  }
  const path = realpathSync(dir)
  if (byPath.has(path)) continue
  const now = new Date().toISOString()
  // Deterministic uuid-shaped id from the canonical path (version nibbles
  // set like a v5 name-hash id) so repeated runs never churn the registry.
  const h = createHash('sha1').update(`dsh-next-e2e-workspace:${path}`).digest('hex')
  const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`
  doc.tables.workspaces[id] = { path, title: basename(path), sessionIds: [], createdAt: now, updatedAt: now }
  if (!doc.global.workspaceIds.includes(id)) doc.global.workspaceIds.push(id)
  byPath.set(path, id)
  added += 1
}

mkdirSync(join(home, 'storages'), { recursive: true })
writeFileSync(file, JSON.stringify(doc, null, 2) + '\n')
console.log(`e2e-seed-workspaces: ${added} added, ${byPath.size} registered in ${file}`)
EOF
