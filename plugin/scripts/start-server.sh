#!/bin/sh
# Starts the minecraft-schematic-lab MCP server for the Claude Code plugin (see ../.mcp.json).
#
# A Minecraft player may have no Node, or one that only their terminal can find (the Claude Code
# desktop app doesn't always see nvm/Homebrew), so this script makes the server start anyway:
#
#   1. Find Node >= 22: PATH, then the usual install places (Homebrew, nvm, Volta, fnm, asdf, mise),
#      then a private copy. None? Download the official Node LTS build from nodejs.org into
#      ~/.minecraft-schematic-lab/runtime/node (checksum-verified, no admin rights, nothing else on
#      the system changes).
#   2. Runtime npm deps: Claude Code installs them from package-lock.json when it caches the plugin.
#      If that didn't happen (no npm on its PATH, older Claude Code, --plugin-dir), install them
#      here with that Node's npm, once per plugin version.
#   3. exec the bundled server in MCP mode.
#
# stdout is the MCP channel: everything this script says goes to stderr.
# `sh start-server.sh --check` does steps 1-2 and reports, without starting the server.
#
# POSIX sh on purpose: on Debian/Ubuntu /bin/sh is dash.

set -u

NEED_MAJOR=22
NODE_LINE=24 # the LTS line downloaded when no suitable Node is installed
ROOT=$(cd "$(dirname "$0")/.." && pwd -P)
RUNTIME="${MSL_HOME:-$HOME/.minecraft-schematic-lab}/runtime"
MODE=${1:-start}

log() { printf 'minecraft-schematic-lab: %s\n' "$*" >&2; }
die() {
  log "$*"
  exit 1
}

# --- 1) Node ---------------------------------------------------------------------------------

NODE=
NODE_BEST=0

consider() { # $1 = path to a node binary; keeps the newest one >= NEED_MAJOR
  [ -x "$1" ] || return 0
  m=$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 0
  case $m in '' | *[!0-9]*) return 0 ;; esac
  if [ "$m" -ge "$NEED_MAJOR" ] && [ "$m" -gt "$NODE_BEST" ]; then
    NODE=$1
    NODE_BEST=$m
  fi
}

find_node() {
  if p=$(command -v node 2>/dev/null); then consider "$p"; fi
  [ -n "$NODE" ] && return 0
  for c in \
    /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node \
    /opt/homebrew/opt/node@*/bin/node /usr/local/opt/node@*/bin/node \
    "${NVM_DIR:-$HOME/.nvm}"/versions/node/*/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/share/fnm/node-versions/"*/installation/bin/node \
    "$HOME/Library/Application Support/fnm/node-versions/"*/installation/bin/node \
    "$HOME/.asdf/installs/nodejs/"*/bin/node \
    "$HOME/.local/share/mise/installs/node/"*/bin/node \
    "$RUNTIME/node/bin/node"; do
    consider "$c"
  done
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d ' ' -f 1
  else
    sha256sum "$1" | cut -d ' ' -f 1
  fi
}

download_node() {
  case $(uname -s) in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "Node $NEED_MAJOR+ is needed: install it from https://nodejs.org and restart Claude Code." ;;
  esac
  case $(uname -m) in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=x64 ;;
    *) die "Node $NEED_MAJOR+ is needed: install it from https://nodejs.org and restart Claude Code." ;;
  esac
  # An x64 process under Rosetta still gets the native build.
  if [ "$os" = darwin ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null)" = 1 ]; then
    arch=arm64
  fi
  command -v curl >/dev/null 2>&1 || die "curl is missing; install Node $NEED_MAJOR+ from https://nodejs.org."

  base="https://nodejs.org/dist/latest-v$NODE_LINE.x"
  mkdir -p "$RUNTIME" || die "Cannot create $RUNTIME."
  tmp=$(mktemp -d "$RUNTIME/node-download.XXXXXX") || die "Cannot create a folder in $RUNTIME."
  log "Node $NEED_MAJOR+ not found: downloading Node $NODE_LINE from nodejs.org into $RUNTIME (one time)."
  if ! curl -fsSL "$base/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"; then
    rm -rf "$tmp"
    die "Could not reach nodejs.org. The first start needs internet."
  fi
  file=$(grep -o "node-v[0-9.]*-$os-$arch\.tar\.gz" "$tmp/SHASUMS256.txt" | head -n 1)
  [ -n "$file" ] || {
    rm -rf "$tmp"
    die "No Node $NODE_LINE build for $os-$arch."
  }
  if ! curl -fsSL "$base/$file" -o "$tmp/$file"; then
    rm -rf "$tmp"
    die "Node download failed. The first start needs internet."
  fi
  expected=$(grep " $file\$" "$tmp/SHASUMS256.txt" | cut -d ' ' -f 1)
  if [ -z "$expected" ] || [ "$(sha256 "$tmp/$file")" != "$expected" ]; then
    rm -rf "$tmp"
    die "The downloaded Node failed its checksum; try again."
  fi
  tar -xzf "$tmp/$file" -C "$tmp" || {
    rm -rf "$tmp"
    die "Could not unpack $file."
  }
  rm -rf "$RUNTIME/node"
  mv "$tmp/${file%.tar.gz}" "$RUNTIME/node" || die "Could not install Node into $RUNTIME/node."
  rm -rf "$tmp"
  log "Node $("$RUNTIME/node/bin/node" -v) installed in $RUNTIME/node."
}

find_node
if [ -z "$NODE" ]; then
  download_node
  find_node
  [ -n "$NODE" ] || die "Node $NEED_MAJOR+ is still missing after the download."
fi
NODE_DIR=$(dirname "$NODE")
# npm's own launcher is `#!/usr/bin/env node`, and the server spawns `open`: keep both findable.
PATH="$NODE_DIR:$PATH:/usr/bin:/bin"
export PATH

# --- 2) Runtime dependencies -------------------------------------------------------------------

deps_ok() {
  # .package-lock.json is written by npm at the very end of an install: a half-done one lacks it.
  [ -f "$ROOT/node_modules/.package-lock.json" ] || return 1
  (cd "$ROOT" && "$NODE" -e '
    const { existsSync } = require("node:fs");
    for (const d of Object.keys(require("./package.json").dependencies))
      if (!existsSync(`node_modules/${d}/package.json`)) process.exit(1);
    require("@napi-rs/canvas"); // the native binary must match this Node platform/arch
  ') >/dev/null 2>&1
}

LOCK="$ROOT/.install-lock"

install_deps() {
  [ -w "$ROOT" ] || die "Cannot write to $ROOT to install the dependencies."
  NPM="$NODE_DIR/npm"
  [ -x "$NPM" ] || die "npm was not found next to $NODE."
  log "Installing the server's dependencies with $("$NODE" -v) (one time, about a minute)."
  # nohup: if Claude Code gives up waiting and stops this script, the install still finishes and
  # the next start is instant.
  (cd "$ROOT" && exec nohup "$NPM" ci --omit=dev --ignore-scripts --no-audit --no-fund \
    --loglevel=error >"$ROOT/.install.log" 2>&1) &
  npm_pid=$!
  echo "$npm_pid" >"$LOCK/pid"
  wait "$npm_pid"
  status=$?
  rm -rf "$LOCK"
  if [ "$status" -ne 0 ] || ! deps_ok; then
    cat "$ROOT/.install.log" >&2 2>/dev/null
    die "Installing the dependencies failed (log: $ROOT/.install.log). The first start needs internet."
  fi
  log "Dependencies ready."
}

ensure_deps() {
  deps_ok && return 0
  waited=0
  while ! mkdir "$LOCK" 2>/dev/null; do
    # Another Claude Code session is installing: wait for it, or take over if it died.
    pid=$(cat "$LOCK/pid" 2>/dev/null)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
      rm -rf "$LOCK"
      continue
    fi
    if [ -z "$pid" ] && [ "$waited" -ge 10 ]; then
      rm -rf "$LOCK" # a lock that never got its pid: its owner died right away
      continue
    fi
    [ "$waited" -ge 600 ] && die "Timed out waiting for another install to finish."
    sleep 1
    waited=$((waited + 1))
    deps_ok && return 0
  done
  if deps_ok; then
    rm -rf "$LOCK"
    return 0
  fi
  install_deps
}

ensure_deps

if [ "$MODE" = --check ]; then
  printf 'Node: %s (%s)\nPlugin: %s\nDependencies: ready\nServer: %s\n' \
    "$NODE" "$("$NODE" -v)" "$ROOT" "$ROOT/server/server.mjs"
  printf 'All set. If the tools are still missing, restart Claude Code (or reconnect the server in /mcp).\n'
  exit 0
fi

# --- 3) Start ---------------------------------------------------------------------------------

exec "$NODE" "$ROOT/server/server.mjs" --mcp
