#!/usr/bin/env bash
# Boot one dsh-next plugin in a dedicated dev profile for inspection:
#   build -> pack (tarball) -> clean file: install -> dump-config -> boot.
# Prints the token-bearing URL. This is the fast iteration loop; the full
# multi-plugin UI proof with DOM markers stays `mise run e2e`.
#
# Usage: bash scripts/dev-plugin.sh <slug> [--port N] [--scratch] [--open]
#
# Why tarballs, not link:: `link:` resolves @deepseek-ai/* SDK deps from this
# repo's node_modules, silently masking a version skew against the installed
# `dsh` CLI. A `file:` tarball is what consumers get and surfaces the skew.
#
# Environment:
#   DSH_DEV_HOME  override the persistent home (default /tmp/dsh-next-dev/home)
#   PORT          default port when --port is not given (default 3927)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf '\033[32m[dev-plugin]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[dev-plugin]\033[0m %s\n' "$*" >&2; exit 1; }

PORT="${PORT:-3927}"
SCRATCH=0
OPEN=0
PROFILE=""
slug=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --scratch) SCRATCH=1; shift ;;
    --open) OPEN=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#--port=}"; shift ;;
    --profile) PROFILE="$2"; shift 2 ;;
    --profile=*) PROFILE="${1#--profile=}"; shift ;;
    -*) die "unknown flag: $1" ;;
    *) [ -z "$slug" ] || die "unexpected argument: $1"; slug="$1"; shift ;;
  esac
done

[ -n "$slug" ] || die "usage: dev-plugin.sh <slug> [--port N] [--scratch] [--open]"
PKG_NAME="@dsh-next/dsh-next-$slug"
PKG_DIR="$ROOT/packages/dsh-next-$slug"
[ -d "$PKG_DIR" ] || die "no package at $PKG_DIR"

say "building $PKG_NAME"
pnpm --filter "$PKG_NAME" build

say "packing $PKG_NAME"
TARBALL="$(cd "$PKG_DIR" && pnpm pack --silent 2>/dev/null | tail -1)"
TARBALL="$(cd "$PKG_DIR" && pwd)/$TARBALL"
[ -f "$TARBALL" ] || die "pnpm pack produced no tarball for $PKG_NAME"

if [ "$SCRATCH" = 1 ]; then
  DSH_HOME="$(mktemp -d /tmp/dsh-next-dev.XXXXXX)/home"
else
  DSH_HOME="${DSH_DEV_HOME:-/tmp/dsh-next-dev/home}"
fi
export DSH_HOME

PROFILE="${PROFILE:-dev-$slug}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
mkdir -p "$PROFILE_DIR"

# First run: seed the profile manifest with the base bundles. The plugin row is
# reconciled into `dsh.profile.bundles` by `dsh plugin add` (it declares
# dsh.bundle.patch), so only the base bundles are written by hand.
if [ ! -f "$PROFILE_DIR/package.json" ]; then
  cat > "$PROFILE_DIR/package.json" <<EOF
{
  "name": "dsh-profile-$PROFILE",
  "private": true,
  "dependencies": {},
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
}
EOF
  printf '[]\n' > "$PROFILE_DIR/cordis.patch.yml"
  cat > "$PROFILE_DIR/pnpm-workspace.yaml" <<'EOF'
packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
EOF
fi

# Clean reinstall: pnpm reports "Already up to date" and keeps a stale `link:`
# symlink in the lockfile when switching install modes, so a `file:` tarball
# would never actually extract without dropping these.
rm -rf "$PROFILE_DIR/node_modules" "$PROFILE_DIR/pnpm-lock.yaml" "$PROFILE_DIR/.dsh-module-fallback"

say "installing tarball into profile $PROFILE ($DSH_HOME)"
dsh plugin --profile "$PROFILE" add "file:$TARBALL"

say "composition check (row must resolve)"
if ! dsh --profile "$PROFILE" --dump-config | grep -q "dsh-next-$slug"; then
  die "dsh-next-$slug did not resolve into the composed tree"
fi

if [ "$OPEN" = 1 ]; then
  LOG="$(mktemp /tmp/dsh-next-dev-boot.XXXXXX)"
  say "booting dsh --profile $PROFILE on port $PORT (opening browser)"
  dsh --profile "$PROFILE" --no-open --port "$PORT" > "$LOG" 2>&1 &
  BOOT_PID=$!
  URL=""
  for _ in $(seq 1 60); do
    if ! kill -0 "$BOOT_PID" 2>/dev/null; then
      echo "=== dsh exited early; log tail ===" >&2
      tail -30 "$LOG" >&2 || true
      exit 1
    fi
    if URL="$(grep -oE 'http://127\.0\.0\.1:[0-9]+[^ ]*' "$LOG" | head -1)" && [ -n "$URL" ]; then
      break
    fi
    sleep 1
  done
  [ -n "$URL" ] || { echo "=== no URL after 60s; log tail ===" >&2; tail -40 "$LOG" >&2 || true; exit 1; }
  say "opening $URL"
  open "$URL"
  wait "$BOOT_PID"
else
  say "booting dsh --profile $PROFILE on port $PORT (URL appears below)"
  exec dsh --profile "$PROFILE" --no-open --port "$PORT"
fi
