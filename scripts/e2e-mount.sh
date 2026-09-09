#!/usr/bin/env bash
# Compatibility entrypoint; pnpm/mise share the Node workflow implementation.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec node "$ROOT/scripts/workflow.mjs" e2e "$@"
