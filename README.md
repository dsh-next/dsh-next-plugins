# dsh-next-plugins

A monorepo of DeepSeek Harness plugins published under the `@dsh-next` npm scope.

Each plugin is an independent Cordis bundle mounted through `cordis.patch.yml`
and DSH profiles, written in TypeScript and built with the shared
`shared/tsdown.client.ts` preset.

## Packages

| Package | Description |
| --- | --- |
| `@dsh-next/dsh-next-cc-plugins` | Claude Code plugin marketplace bridge: install marketplace plugins as native skills, MCP and agent composition rows, slash commands, and hooks |
| `@dsh-next/dsh-next-notifier` | Browser and OS notifications (JS prototype, conversion pending) |
| `@dsh-next/dsh-next-skills` | Skill marketplace manager: browse provider catalogs, install skills globally, and control per-workspace enablement |

## Development

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
pnpm plugin:new <slug>
```

See [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md) for repository
rules and conventions.

## License

MIT. Copyright (c) 2026 Rok Grabnar.
