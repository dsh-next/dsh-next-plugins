#!/usr/bin/env bash
# Compatibility alias: owned keyless skills inspection; stop with Ctrl-C.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/workflow-preview.mjs" skills "$@"
