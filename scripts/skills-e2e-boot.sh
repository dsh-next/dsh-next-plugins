#!/usr/bin/env bash
# Boot an isolated DSH smoke profile with ONLY the skills plugin mounted, and
# keep it alive for a human/agent to inspect + screenshot via Playwright.
#
# Usage: bash scripts/skills-e2e-boot.sh
# Teardown: kill $(cat .skills-e2e.pid)
#
# Env: SKILLS_E2E_PORT fixed port (default 0 = OS-assigned)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

DSH_CMD="${DSH_CMD:-dsh}"
PORT="${SKILLS_E2E_PORT:-0}"

SCRATCH="${SKILLS_E2E_HOME:-$(mktemp -d /tmp/dsh-next-skills.XXXXXX)}"
export DSH_HOME="$SCRATCH/home"
export DSH_AGENTS_HOME="$SCRATCH/home/agents"
mkdir -p "$DSH_HOME/profiles/smoke"
echo "scratch home: $DSH_HOME"

PROFILE_DIR="$DSH_HOME/profiles/smoke"
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

cat > "$DSH_HOME/settings.yaml" <<'EOF'
ui-onboarding:
  welcomeNoticeVersion: 2099-01-01.1
agent-default-model:
  provider: deepseek-official
  model: deepseek-v4-flash-vision-exp
  reasoningEffort: high
llm-pi-ai:
  providers:
    test:
      apiKeyEnv: DSH_E2E_FAKE_KEY
      models:
        - id: glm-5.3-flash
          name: GLM-5.3-Flash
          input: ["text", "image"]
          output: ["text"]
EOF

# Seed one workspace so chat flows (the composer "/" skill menu, the verify
# script's stale-cache check) work on a fresh scratch: the durable workspace
# registry is a plain JSON store under $DSH_HOME/storages. The path must be
# the canon (realpath) form — on macOS /tmp is a symlink to /private/tmp and
# a non-canon path silently fails session-cwd resolution.
mkdir -p "$DSH_HOME/storages" "$SCRATCH/ws-alpha"
CANON_SCRATCH="$(cd "$SCRATCH" && pwd -P)"
NOW="$(date -u +%FT%TZ)"
cat > "$DSH_HOME/storages/workspace.json" <<EOF
{
  "unit": { "name": "workspace", "version": 2 },
  "global": {
    "initialized": true,
    "workspaceIds": ["ws-seed-alpha-0000-0000-000000000001"],
    "archivedSessionIds": []
  },
  "tables": {
    "workspaces": {
      "ws-seed-alpha-0000-0000-000000000001": {
        "path": "$CANON_SCRATCH/ws-alpha",
        "title": "Alpha",
        "sessionIds": [],
        "createdAt": "$NOW",
        "updatedAt": "$NOW"
      }
    }
  }
}
EOF

# Seed a few throwaway skills (one block-scalar, one flat, one already disabled)
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
mkdir -p "$DSH_AGENTS_HOME/skills/grill-me"
cat > "$DSH_AGENTS_HOME/skills/grill-me/SKILL.md" <<'EOF'
---
name: grill-me
description: Ask me a hard question and grill me on the answer.
---
# Changelog
EOF
mkdir -p "$DSH_AGENTS_HOME/skills/opentofu"
cat > "$DSH_AGENTS_HOME/skills/opentofu/SKILL.md" <<'EOF'
---
name: opentofu
description: |
  Terraform / OpenTofu infrastructure as code help.
  Handles plan, apply, and state review.
disable-model-invocation: true
user-invocable: false
---
# Ops
EOF

# Mount ONLY the skills plugin (link to the already-built package).
$DSH_CMD plugin --profile smoke add "link:$ROOT/packages/dsh-next-skills"

echo "=== composed profile tree ==="
$DSH_CMD --profile smoke --dump-config 2>&1 | grep -i -A 2 -B 2 skills || true

export DSH_E2E_FAKE_KEY="${DSH_E2E_FAKE_KEY:-fake-e2e-key}"
WEB_LOG="$SCRATCH/web.log"
$DSH_CMD --profile smoke --no-open --port "$PORT" > "$WEB_LOG" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$ROOT/.skills-e2e.pid"

URL=""
for _ in $(seq 1 120); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== dsh exited early; log tail ===" >&2
    tail -40 "$WEB_LOG" >&2 || true
    exit 1
  fi
  if URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$WEB_LOG" | head -1)" && [ -n "$URL" ]; then
    break
  fi
  sleep 1
done
[ -n "$URL" ] || { echo "=== no URL after 120s; log tail ===" >&2; tail -50 "$WEB_LOG" >&2 || true; exit 1; }

echo "$URL" > "$ROOT/.skills-e2e.url"
echo "ready: $URL"
echo "pid: $SERVER_PID (files: .skills-e2e.pid / .skills-e2e.url)"
echo "scratch: $DSH_HOME"
echo "web.log: $WEB_LOG"
