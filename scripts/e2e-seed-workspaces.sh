#!/usr/bin/env bash
# Register directories in a STOPPED scratch DSH runtime's workspace registry.
# Never run against a live runtime: atomic replacement prevents partial JSON,
# but does not coordinate concurrent writers or prevent lost updates.
#
# Usage: e2e-seed-workspaces.sh <DSH_HOME> <workspace-dir> [more-dirs...]
#
# Paths (including spaces) are passed unchanged, then canonicalized by realpath.
# Existing registrations and unknown fields are preserved; repeated paths are
# no-ops. New ids are deterministic and titles use the directory base name.
# Corrupt/unsupported registries fail closed without replacing the original.
# scripts/e2e-mount.sh seeds before startup and exports canonical paths as
# DSH_E2E_WORKSPACE_A / _B for workspace-scoped assertions.

set -euo pipefail

exec node "$(dirname -- "${BASH_SOURCE[0]}")/e2e-seed-workspaces.mjs" "$@"
