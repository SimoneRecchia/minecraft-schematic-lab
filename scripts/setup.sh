#!/usr/bin/env bash
# minecraft-schematic-lab one-time setup helper.
#
# This is NOT a double-click launcher. Claude Code runs it for the user the first
# time they ask to build a schematic. It is idempotent and safe to re-run: it only
# does the missing pieces, never anything destructive, and never uses sudo.
#
# What it does:
#   1. Ensure Node >= 22 (install via nvm, no admin rights, if missing).
#   2. Ensure pnpm (enable via corepack, pin the repo's version).
#   3. pnpm install  +  pnpm build  (the build produces the browser viewer).
#   4. Register the MCP connector with a PATH-safe wrapper (so it also works in the
#      Claude Code DESKTOP app), if the `claude` CLI is available. Otherwise print
#      the exact manual command.
#
# Re-run anytime. Override the port for the later build step with: PORT=9000 (config only).

set -euo pipefail

# --- Resolve THIS script's dir and the repo root (symlink-safe, cwd-independent) ---
SOURCE="${BASH_SOURCE[0]}"
while [ -h "$SOURCE" ]; do
  DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ $SOURCE != /* ]] && SOURCE="$DIR/$SOURCE"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SOURCE")" >/dev/null 2>&1 && pwd)"
REPO_DIR="$(cd -P "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)"

NEED_MAJOR=22
PNPM_VERSION="11.6.0"
CONNECTOR_NAME="minecraft-schematic-lab"
WRAPPER="$SCRIPT_DIR/mcp-launch.sh"

say() { printf '%s\n' "==> $*"; }
warn() { printf '%s\n' "!!  $*" >&2; }

# --- Idempotency: if everything is already in place, do nothing ---
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

already_setup() {
  command -v node >/dev/null 2>&1 || return 1
  [ "$(node_major)" -ge "$NEED_MAJOR" ] || return 1
  command -v pnpm >/dev/null 2>&1 || return 1
  [ -d "$REPO_DIR/node_modules" ] || return 1
  [ -f "$REPO_DIR/apps/web/dist/index.html" ] || return 1
  if command -v claude >/dev/null 2>&1; then
    claude mcp list 2>/dev/null | grep -q "$CONNECTOR_NAME" || return 1
  fi
  return 0
}

if already_setup; then
  say "Already set up. Nothing to do."
  say "Repo: $REPO_DIR"
  exit 0
fi

say "Setting up minecraft-schematic-lab (one time)."
say "Repo: $REPO_DIR"

# --- 1) Node >= 22, via nvm (no sudo) ---
node_ok=false
if command -v node >/dev/null 2>&1 && [ "$(node_major)" -ge "$NEED_MAJOR" ]; then
  node_ok=true
fi

installed_node_via_nvm=false
if [ "$node_ok" = false ]; then
  say "Node >= $NEED_MAJOR not found. Installing nvm + Node $NEED_MAJOR (no admin password needed)."
  say "This step needs internet access."
  export NVM_DIR="$HOME/.nvm"
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
  fi
  # The installer only edits future shells; source nvm inline so node is usable NOW.
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm install "$NEED_MAJOR"
  nvm use "$NEED_MAJOR" >/dev/null
  nvm alias default "$NEED_MAJOR" >/dev/null
  installed_node_via_nvm=true
else
  # If nvm is present from a prior run, make its node visible in this shell too.
  if [ -s "$HOME/.nvm/nvm.sh" ] && ! command -v node >/dev/null 2>&1; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
  fi
fi

command -v node >/dev/null 2>&1 || { warn "Node still not on PATH after install. Aborting."; exit 1; }
say "Node $(node -v) ready."

# --- 2) pnpm, via corepack (ships with Node; pins the repo's version) ---
if ! command -v pnpm >/dev/null 2>&1; then
  say "Enabling pnpm via corepack."
  if command -v corepack >/dev/null 2>&1; then
    # corepack writes shims next to the active node. nvm/Homebrew dirs are user-writable;
    # the official .pkg installs to /usr/local/bin and may need sudo -> don't hard-fail.
    corepack enable pnpm >/dev/null 2>&1 || warn "corepack enable could not write a global shim (continuing)."
    corepack prepare "pnpm@$PNPM_VERSION" --activate >/dev/null 2>&1 || \
      warn "corepack prepare pnpm@$PNPM_VERSION failed (continuing if pnpm resolves)."
  else
    warn "corepack not found alongside node."
  fi
fi

if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm is not available. Last resort: 'npm install -g pnpm' (may need a writable npm prefix),"
  warn "then re-run this script. Aborting for now."
  exit 1
fi
say "pnpm $(pnpm -v) ready."

# --- 3) Install + build (build = web viewer at apps/web/dist; server runs via tsx) ---
if [ -d "$REPO_DIR/node_modules" ]; then
  say "Dependencies present; running install to reconcile the lockfile (idempotent)."
else
  say "Installing dependencies."
fi
pnpm --dir "$REPO_DIR" install

if [ -f "$REPO_DIR/apps/web/dist/index.html" ]; then
  say "Web viewer already built; skipping build."
else
  say "Building the browser viewer."
  pnpm --dir "$REPO_DIR" build
fi

if [ ! -f "$REPO_DIR/apps/web/dist/index.html" ]; then
  warn "Build did not produce apps/web/dist/index.html. The HTTP API will still work, but the browser"
  warn "preview won't render. Check 'pnpm --dir \"$REPO_DIR\" build' output."
fi

# --- 4) Register the MCP connector with a PATH-safe wrapper ---
# Why a wrapper: the Claude Code DESKTOP app launches from the GUI and does NOT inherit the
# interactive shell PATH. A bare `pnpm --dir ... mcp` then fails silently because pnpm/node
# (nvm or Homebrew) aren't on the GUI's minimal PATH, and pnpm itself execs `node` and re-invokes
# `pnpm` (the root `mcp` script is `pnpm --filter ... mcp`). The wrapper prepends BOTH node's and
# pnpm's absolute dirs to PATH and execs the absolute pnpm, which fixes all of that even if pnpm
# and node live in different directories.
NODE_BIN="$(command -v node)"
NODE_BIN_DIR="$(dirname "$NODE_BIN")"
PNPM_BIN="$(command -v pnpm)"
PNPM_BIN_DIR="$(dirname "$PNPM_BIN")"

say "Writing PATH-safe MCP launch wrapper: $WRAPPER"
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
# Generated by scripts/setup.sh. Makes node/pnpm findable when launched from the GUI
# (Claude Code Desktop) which does not inherit the interactive shell PATH.
export PATH="$NODE_BIN_DIR:$PNPM_BIN_DIR:\$PATH"
exec "$PNPM_BIN" --dir "$REPO_DIR" mcp
EOF
chmod +x "$WRAPPER"

MANUAL_CMD="claude mcp add --scope user $CONNECTOR_NAME -- \"$WRAPPER\""

if command -v claude >/dev/null 2>&1; then
  say "Registering MCP connector '$CONNECTOR_NAME' (user scope)."
  # Idempotent + non-destructive: only ever touches our own named entry.
  claude mcp remove --scope user "$CONNECTOR_NAME" >/dev/null 2>&1 || true
  if claude mcp add --scope user "$CONNECTOR_NAME" -- "$WRAPPER"; then
    say "Connector registered. RESTART Claude Code once so the schematic tools load."
  else
    warn "Automatic registration failed. Run this manually:"
    warn "  $MANUAL_CMD"
  fi
else
  warn "The 'claude' CLI is not on PATH, so the connector was not auto-registered."
  warn "Either run this in a terminal that has the Claude Code CLI:"
  warn "  $MANUAL_CMD"
  warn "or, in Claude Code Desktop, add an MCP server named '$CONNECTOR_NAME' whose command is:"
  warn "  $WRAPPER"
fi

if [ "$installed_node_via_nvm" = true ]; then
  say "NOTE: Node was installed via nvm (under ~/.nvm). For the Claude Code DESKTOP app the wrapper"
  say "above handles PATH. If you prefer the simplest setup, you can instead install Node from the"
  say "official installer at https://nodejs.org (it lands in /usr/local/bin, on the GUI PATH)."
fi

say "Setup complete."
say "Next: the schematic is built over HTTP for the first request (server started from apps/server),"
say "then the standalone server is stopped; after restarting Claude Code the MCP connector starts its"
say "own server and the MCP tools open/refresh the browser preview automatically on port 8765."

