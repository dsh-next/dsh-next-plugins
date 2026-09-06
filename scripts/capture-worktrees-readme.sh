#!/usr/bin/env bash
# Capture dark-theme README screenshots for dsh-next-worktrees.
# Boots an isolated scratch DSH (never ~/.dsh) with only this plugin, a
# realistic "harbor" git workspace, and ui-theme preference: dark.
#
# Usage: bash scripts/capture-worktrees-readme.sh
# Env:   KEEP_HOME=1 to keep the scratch dir; PORT=N to pin the port.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT="${OUT:-$ROOT/packages/dsh-next-worktrees/media}"
PORT="${PORT:-0}"
DSH_CMD="${DSH_CMD:-dsh}"

say() { printf '\033[32m[readme-shots]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[readme-shots]\033[0m %s\n' "$*" >&2; exit 1; }

command -v "$DSH_CMD" >/dev/null 2>&1 || die "dsh not on PATH"
command -v node >/dev/null 2>&1 || die "node not found"

say "building @dsh-next/dsh-next-worktrees"
pnpm --filter @dsh-next/dsh-next-worktrees build

say "packing"
TARBALL="$(cd "$ROOT/packages/dsh-next-worktrees" && pnpm pack --silent 2>/dev/null | tail -1)"
TARBALL="$ROOT/packages/dsh-next-worktrees/$TARBALL"
[ -f "$TARBALL" ] || die "pnpm pack produced no tarball"

SCRATCH="$(mktemp -d /tmp/dsh-next-readme.XXXXXX)"
export DSH_HOME="$SCRATCH/home"
export DSH_AGENTS_HOME="$SCRATCH/home/agents"
mkdir -p "$DSH_HOME/profiles/readme" "$DSH_AGENTS_HOME"
say "scratch home: $DSH_HOME"

PROFILE_DIR="$DSH_HOME/profiles/readme"
cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-readme",
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
  model: deepseek-v4-flash
ui-theme:
  preference: dark
  fontSize: 14
locale:
  preference: en
EOF

HARBOR="$SCRATCH/harbor"
mkdir -p "$HARBOR/src"
cat > "$HARBOR/README.md" <<'EOF'
# Harbor

Checkout and cart API for the storefront.
EOF
cat > "$HARBOR/package.json" <<'EOF'
{
  "name": "harbor",
  "private": true,
  "type": "module"
}
EOF
cat > "$HARBOR/src/checkout.ts" <<'EOF'
export function charge(orderId: string): Promise<void> {
  return Promise.resolve()
}
EOF
git -C "$HARBOR" init -q -b main
git -C "$HARBOR" config user.email 'docs@example.com'
git -C "$HARBOR" config user.name 'Harbor'
git -C "$HARBOR" config commit.gpgsign false
git -C "$HARBOR" add README.md package.json src/checkout.ts
git -C "$HARBOR" commit -q -m 'Initial storefront checkout'

HARBOR_CANON="$(cd "$HARBOR" && pwd -P)"
bash "$ROOT/scripts/e2e-seed-workspaces.sh" "$DSH_HOME" "$HARBOR_CANON"
say "seeded workspace $HARBOR_CANON"

say "installing worktrees tarball"
$DSH_CMD plugin --profile readme add "file:$TARBALL"

export DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-fake-e2e-key}"
WEB_LOG="$SCRATCH/web.log"
say "booting dsh --profile readme (port=$PORT)"
$DSH_CMD --profile readme --no-open --port "$PORT" > "$WEB_LOG" 2>&1 &
SERVER_PID=$!

cleanup() {
  local code=$?
  if [ -n "${SERVER_PID:-}" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
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

URL=""
for _ in $(seq 1 150); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "=== dsh exited early; log tail ===" >&2
    tail -40 "$WEB_LOG" >&2 || true
    exit 1
  fi
  if URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+[^ ]*' "$WEB_LOG" | head -1)" && [ -n "$URL" ]; then
    break
  fi
  sleep 1
done
[ -n "$URL" ] || { echo "=== no URL after 150s; log tail ===" >&2; tail -40 "$WEB_LOG" >&2 || true; exit 1; }
say "ready at $URL"

mkdir -p "$OUT"
say "capturing into $OUT"
DSH_README_URL="$URL" DSH_README_WORKSPACE="$HARBOR_CANON" DSH_README_OUT="$OUT" \
  node "$SCRIPT_DIR/capture-worktrees-readme.mjs"

say "done"
ls -l "$OUT"
