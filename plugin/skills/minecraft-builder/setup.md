# When the VibeSchem tools are missing

The tools come from a small server on the user's computer. Find the case that applies and explain it
in plain words, in their language:

- **Inside the minecraft-schematic-lab repository** (its CLAUDE.md is loaded): follow CLAUDE.md
  (one-time setup, first build over HTTP).
- **Claude Code with the plugin installed** (your commands run on the user's computer): the first
  start prepares Node and the server's parts once (internet, about a minute) and may have outlasted
  Claude Code's wait. Tell the user it's a one-time preparation and run
  `sh "${CLAUDE_SKILL_DIR}/../../scripts/start-server" --check` on macOS or Linux; on Windows run the
  file `"${CLAUDE_SKILL_DIR}/../../scripts/start-server.cmd"` with `--check` (from PowerShell:
  `& "<path>" --check`). It finishes the job, or says in its last lines what is missing. Then ask
  them to open a new session or restart Claude Code so the tools load.
- **A task in the Claude desktop app** (Cowork): the plugin's server starts on their computer, but
  your commands run in a sandbox, so don't run the script. Ask them to wait a minute and start a new
  task: the first start prepares everything once.
- **A chat** (claude.ai, the desktop app's chat or the phone app) where this skill came with the
  plugin: a chat can't start the plugin's server. The builder works in Claude Code (terminal or the
  desktop app's Code tab) and in desktop-app tasks on their computer. In the desktop app's chat they
  can use the desktop extension instead: download `vibeschem.mcpb` from
  https://github.com/SimoneRecchia/minecraft-schematic-lab/releases/latest and double-click it (or
  turn it on in Settings → Extensions), then start a new chat. A browser or a phone alone can't run
  it.
- **Claude Code without the plugin**: ask them to install it with
  `/plugin marketplace add SimoneRecchia/minecraft-schematic-lab`, then
  `/plugin install vibeschem@vibeschem` (or from **Customize → Plugins** in the Claude app), and to
  restart Claude Code once.
