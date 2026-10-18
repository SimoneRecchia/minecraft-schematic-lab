# Contributing to VibeSchem

Bug reports, ideas and pull requests are welcome on
[GitHub](https://github.com/SimoneRecchia/minecraft-schematic-lab/issues).

## Before you open a pull request

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test   # pnpm test:e2e for viewer changes
pnpm bundle                                # after changing the server, viewer, guides or skill
claude plugin validate ./plugin --strict   # Claude Code 2.1.281+ knows the directory listing fields
```

`plugin/` is what players install and what Anthropic's plugin directory lists, so it is committed:
rebuild it with `pnpm bundle` in the same pull request. [CLAUDE.md](CLAUDE.md) describes the
architecture and the conventions; the README's Development section lists the commands.

## License of contributions

VibeSchem is licensed under the GNU Affero General Public License v3 only
([LICENSE](LICENSE)). By contributing, you agree that your contribution is licensed under the same
license. The name and logo are not part of it: see [TRADEMARKS.md](TRADEMARKS.md).
