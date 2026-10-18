# Changelog

Installed plugins update when `version` changes (root `package.json`, synced into the plugin and the
desktop extension by `pnpm bundle`).

## 0.3.1

- Fix: Claude dropped the `focus_view`, `inspect` and `render_views` tools, because their `[x, y, z]`
  coordinates were described as a JSON Schema draft-07 tuple, which the Claude API (JSON Schema
  2020-12) rejects. A test now checks every tool's schema against 2020-12.

## 0.3.0

- **New name: VibeSchem**, "AI builder for Minecraft". Plugin `vibeschem@vibeschem`, desktop
  extension `vibeschem.mcpb`. Coming from `minecraft-schematic-lab`? Uninstall it first (see the
  README); your builds stay in `~/.minecraft-schematic-lab`.
- **Windows** support for the plugin: one launch command for every OS (`scripts/start-server`, with
  `start-server.cmd` on Windows), and Node is downloaded when missing, without admin rights.
- Ready for **Anthropic's plugin directory**: listing page (`plugin/README.md`), icon, privacy
  policy, documentation and support links, third-party notices.
- **Security**: build scripts run in a sandbox that can't reach Node; the local server answers only
  its own viewer (no DNS rebinding or cross-site requests) and binds to `127.0.0.1` only; a stray
  promise rejection no longer stops it; fastify, @fastify/static and the MCP SDK updated past their
  advisories; Node downloads pinned to v24.22.0 with SHA-256 sums; exports never overwrite a file.
  See [SECURITY.md](SECURITY.md) to report a problem.
- MCP tools carry titles and read-only/destructive annotations, and say they are for Minecraft.
- **License: GNU AGPL v3** (`AGPL-3.0-only`) instead of MIT. The name and logo are reserved
  ([TRADEMARKS.md](TRADEMARKS.md)). Versions up to 0.2.0 stay available under MIT.

## 0.2.0

- Rewrite: expert building guides and BuildSpec, live 3D viewer with the real game textures and
  block models, strict Minecraft versions from 1.8 to the newest, exports for WorldEdit, Litematica
  and structure blocks.
- Claude Code plugin, and a Claude Desktop extension for the chat.

## 0.1.0

- First version: build Minecraft schematics by chatting with Claude.
