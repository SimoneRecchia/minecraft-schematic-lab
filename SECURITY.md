# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue: open the repository's
[Security tab](https://github.com/SimoneRecchia/minecraft-schematic-lab/security) and select
**Report a vulnerability**. Describe what you found, how to reproduce it and which version you used
(`/mcp` in Claude Code, or `version` in `plugin/.claude-plugin/plugin.json`).

You'll get an answer within 7 days. Fixes ship as a new plugin version; the report is credited in
the changelog unless you prefer otherwise.

## Supported versions

Only the latest version gets security fixes. Installed plugins update when a new version is
published.

## Scope

VibeSchem runs on the user's computer: the launcher scripts, the local server and its HTTP API on
`127.0.0.1`, the 3D viewer, the sandbox for build scripts, and the files it writes. Reports about
Claude itself go to Anthropic: https://www.anthropic.com/responsible-disclosure-policy.
