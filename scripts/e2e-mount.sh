#!/usr/bin/env bash
# Mount smoke: pack every @dsh-next/dsh-next-* plugin, mount it into a real
# scratch DSH profile through the official `dsh plugin --profile <name> add`
# channel, boot `dsh web` keyless, and run the Playwright headless render lane
# (tests/e2e/mount.e2e.ts) to prove every plugin mounts with no crash markers.
#
# Usage: bash scripts/e2e-mount.sh
#
# Environment (all optional):
#   DSH_CMD       dsh command; defaults to PATH `dsh`, falling back to npx
#   PORT          fixed port (default 0 = OS-assigned, parsed from the log)
#   DSH_HOME_BASE override the scratch root (default mktemp -d)
#   KEEP_HOME     non-empty to keep the scratch home for debugging
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DSH_CMD="${DSH_CMD:-dsh}"
PORT="${PORT:-0}"

say()  { printf '\033[32m[e2e-mount]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[e2e-mount]\033[0m %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "node not found"
command -v pnpm >/dev/null 2>&1 || die "pnpm not found"

# dsh CLI resolution: PATH first, else npx pulls the official package.
if ! command -v "$DSH_CMD" >/dev/null 2>&1; then
  if command -v npx >/dev/null 2>&1; then
    say "no $DSH_CMD on PATH, falling back to npx @deepseek-ai/dsh"
    DSH_CMD="npx -y --package @deepseek-ai/dsh dsh"
  else
    die "no dsh or npx on PATH; install the DSH CLI or set DSH_CMD"
  fi
fi

# Scratch home (never touch the real ~/.dsh).
SCRATCH="${DSH_HOME_BASE:-$(mktemp -d /tmp/dsh-next-e2e.XXXXXX)}"
export DSH_HOME="$SCRATCH/home"
# Isolate the shared agent skills root too: without this, both the DSH
# filesystem skill provider and dsh-next-skills scan the REAL ~/.agents, and
# the smoke would read (and could mutate) the developer's actual skills.
export DSH_AGENTS_HOME="$SCRATCH/home/agents"
mkdir -p "$DSH_HOME/profiles/smoke"
say "scratch home: $DSH_HOME"

PROFILE_DIR="$DSH_HOME/profiles/smoke"
# The base bundles supply every host peer and event source the notifier needs:
#   * dsh-base mounts timer, settings, subprocess, sandbox-policy, goals, and
#     the agent/subagent/approval/tools/goal rows whose events the notifier
#     listens to (agent/status, subagent/end, approval/request, tools/execute,
#     goal/changed).
#   * dsh-web-app mounts the webserver row that serves the webServer service
#     backing the notifier's /dsh-next-notifier/rpc route.
# No extra bundles are required to exercise the notifier's trigger listeners.
cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-smoke",
  "private": true,
  "dependencies": {},
  "dsh": {
    "profile": {
      "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"]
    }
  }
}
EOF
printf '[]\n' > "$PROFILE_DIR/cordis.patch.yml"
cat > "$PROFILE_DIR/pnpm-workspace.yaml" <<'EOF'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
EOF

# A fresh home shows first-run onboarding dialogs (an "Internal Testing Notice"
# and an "Add an API key to get started" modal) whose masks intercept clicks on
# the sidebar, which would make the Playwright lane flaky. Seed the home
# settings so the welcome notice is considered seen and a model provider is
# configured, so no setup modal is required to drive the UI.
cat > "$DSH_HOME/settings.yaml" <<'EOF'
ui-onboarding:
  welcomeNoticeVersion: 2099-01-01.1
agent-default-model:
  provider: llm-pi-ai
  model: glm-5.3-flash
llm-pi-ai:
  providers:
    test:
      apiKeyEnv: DSH_E2E_FAKE_KEY
      models:
        - id: glm-5.3-flash
          name: GLM-5.3-Flash
          input: ["text", "image"]
          output: ["text"]
dsh-next-notifier:
  enabled: true
  suppressFocused: true
  volume: 70
EOF

# Seed one throwaway skill into the isolated agents root so the skills DOM
# marker can exercise a real scope modal and a real two-step remove. The
# matching settings record marks it plugin-managed (remove refuses files the
# plugin did not install), which also exercises the settings.yaml state.
mkdir -p "$DSH_AGENTS_HOME/skills/e2e-test-skill"
cat > "$DSH_AGENTS_HOME/skills/e2e-test-skill/SKILL.md" <<'EOF'
---
name: e2e-test-skill
description: |
  Throwaway skill for the skills marker.
  Multi-line to exercise block-scalar descriptions.
---
# Test
EOF
cat >> "$DSH_HOME/settings.yaml" <<EOF
dsh-next-skills:
  providers: []
  installed:
    - name: e2e-test-skill
      providerId: e2e-local
      providerSpec: e2e/local
      skillPath: skills/e2e-test-skill
      version: seed-v1
      installedAt: "$(date -u +%FT%TZ)"
  scopes: {}
EOF


SERVER_PID=""
cleanup() {
  local code=$?
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ -z "${KEEP_HOME:-}" ]; then
    rm -rf "$SCRATCH"
  else
    say "KEEP_HOME set, keeping $SCRATCH"
  fi
  exit "$code"
}
trap cleanup EXIT

# Pack + mount every plugin in the family.
PLUGIN_IDS=""
for dir in "$ROOT"/packages/dsh-next-*; do
  [ -d "$dir" ] || continue
  [ -f "$dir/package.json" ] || continue
  id="$(basename "$dir")"
  say "packing $id"
  tarball="$(cd "$dir" && pnpm pack --silent 2>/dev/null | tail -1)"
  tarball="$(cd "$dir" && pwd)/$tarball"
  [ -f "$tarball" ] || die "pnpm pack produced no tarball for $id"
  say "mounting $id"
  # shellcheck disable=SC2086
  $DSH_CMD plugin --profile smoke add "file:$tarball"
  # The client bundle is served at /plugins/<package-name>/client.js — the
  # npm name (scope + slug), not the cordis `id` field. Pass the package name.
  PLUGIN_IDS="${PLUGIN_IDS:+$PLUGIN_IDS,}@dsh-next/$id"
done
[ -n "$PLUGIN_IDS" ] || die "no plugins found under packages/dsh-next-*"

# Boot the smoke profile (dsh --profile smoke, NOT `dsh web`, which is a
# hardcoded alias for --profile web and would boot the wrong profile) with an
# OS-assigned port (or fixed PORT), and never auto-open a browser.
WEB_LOG="$SCRATCH/web.log"
say "booting dsh --profile smoke (port=$PORT)"
# Provide the key the seeded llm-pi-ai provider resolves through (apiKeyEnv), so
# a model provider is "ready" and no API-key onboarding modal blocks the lane.
export DSH_E2E_FAKE_KEY="${DSH_E2E_FAKE_KEY:-fake-e2e-key}"
# shellcheck disable=SC2086
$DSH_CMD --profile smoke --no-open --port "$PORT" > "$WEB_LOG" 2>&1 &
SERVER_PID=$!

URL=""
for _ in $(seq 1 150); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== dsh web exited early; log tail ===" >&2
    tail -30 "$WEB_LOG" >&2 || true
    exit 1
  fi
  if URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$WEB_LOG" | head -1)" && [ -n "$URL" ]; then
    break
  fi
  sleep 1
done
[ -n "$URL" ] || { echo "=== no dsh web URL after 150s; log tail ===" >&2; tail -40 "$WEB_LOG" >&2 || true; exit 1; }
say "dsh web ready at $URL (pid $SERVER_PID)"

# Run the headless render lane.
say "running Playwright headless mount smoke"
DSH_E2E_URL="$URL" DSH_E2E_PLUGINS="$PLUGIN_IDS" DSH_E2E_FAKE_KEY="fake-e2e-key" \
  pnpm exec playwright test

say "pass: plugin family mounted into a real DSH with no crash markers"
