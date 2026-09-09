#!/usr/bin/env bash
# Compatibility alias: owned keyless worktrees README capture.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/workflow-preview.mjs" worktrees "$@"
