# minecraft-schematic-lab

Build Minecraft schematics by talking to Claude. Describe what you want and it produces a WorldEdit
Sponge `.schem` with a live 3D preview in the browser. Everything runs locally — no account, no cloud.

## Setup

You need **Node 22+** and **Claude Code** (CLI or desktop app). Add the connector once — either way below
works for both the CLI and the desktop app, since they share the same config.

<details>
<summary><b>Add it with one command</b> &nbsp;(uses the <code>claude</code> CLI)</summary>

<br>

macOS / Linux:

```bash
claude mcp add --scope user minecraft-schematic-lab -- npx -y github:SimoneRecchia/minecraft-schematic-lab --mcp
```

Windows — `npx` needs a `cmd /c` wrapper:

```bat
claude mcp add --scope user minecraft-schematic-lab -- cmd /c npx -y github:SimoneRecchia/minecraft-schematic-lab --mcp
```

If `claude` isn't found, the desktop app doesn't ship the CLI — install it, open a new terminal, and run
the command again:

- **macOS** — `brew install --cask claude-code` (or `curl -fsSL https://claude.ai/install.sh | bash`)
- **Linux** — `curl -fsSL https://claude.ai/install.sh | bash`
- **Windows** — `winget install Anthropic.ClaudeCode` (or `irm https://claude.ai/install.ps1 | iex`)

</details>

<details>
<summary><b>Add it by hand</b> &nbsp;(edit the config file)</summary>

<br>

Add the block under `mcpServers` in your Claude config — `~/.claude.json` for Claude Code
(`%USERPROFILE%\.claude.json` on Windows), or `claude_desktop_config.json` for the Claude Desktop chat app.

macOS / Linux:

```json
{
  "mcpServers": {
    "minecraft-schematic-lab": {
      "command": "npx",
      "args": ["-y", "github:SimoneRecchia/minecraft-schematic-lab", "--mcp"]
    }
  }
}
```

Windows:

```json
{
  "mcpServers": {
    "minecraft-schematic-lab": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "github:SimoneRecchia/minecraft-schematic-lab", "--mcp"]
    }
  }
}
```

</details>

Restart Claude Code so it picks up the connector, then ask:

> build me a 50×40×80 fantasy castle

The first run pulls the tool through `npx`; the 3D preview then opens at <http://127.0.0.1:8765>.

## Using it

- **Change it** — "make the roof brick", "add two towers". The preview refreshes on its own.
- **Export** — the **Export .schem** button in the browser, or ask Claude (Sponge v2, or v3).
- **In Minecraft** — put the `.schem` in your world's `schematics` folder, then `//schem load <name>` and `//paste`.
- **Versions** — ask Claude to version a build in a folder (needs git).
- **Updates** — the connector follows `main`; pin a release with `#v0.1.0`, or clear a stale cache with `npm cache clean --force`.

## Platform support

| OS                              | CLI | Desktop app | Note                             |
| ------------------------------- | :-: | :---------: | -------------------------------- |
| macOS (Intel / Apple Silicon)   | ✅  |     ✅      |                                  |
| Windows 10/11 (x64 / ARM64)     | ✅  |     ✅      | `npx` needs `cmd /c` (see Setup) |
| Linux (x64 / ARM64, incl. musl) | ✅  |     —       | no desktop app on Linux          |

Node 22+ on every platform; 32-bit isn't supported.

## Develop

```bash
pnpm setup        # install + build
pnpm dev          # web (5173) + server (8765), hot reload
pnpm test         # vitest
pnpm bundle       # rebuild bundle/ for the npx connector (commit after server changes)
```

Architecture, MCP tools, the HTTP API and the BuildSpec format are documented in [`CLAUDE.md`](CLAUDE.md).

## License

MIT © 2026 SimoneRecchia
