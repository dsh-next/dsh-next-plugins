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
| `@dsh-next/dsh-next-cron` | Scheduled task automation |
| `@dsh-next/dsh-next-files` | File operations |
| `@dsh-next/dsh-next-git` | Git integration |
| `@dsh-next/dsh-next-org` | Organization tooling |
| `@dsh-next/dsh-next-previews` | Preview generation |
| `@dsh-next/dsh-next-slack` | Slack integration |
| `@dsh-next/dsh-next-telegram` | Telegram integration |
| `@dsh-next/dsh-next-workflows` | Workflow orchestration |

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
