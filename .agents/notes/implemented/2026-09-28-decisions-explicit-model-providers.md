# Separate decision-only providers with explicit model IDs

- date: 2026-09-28
- status: implemented
- scope: packages/dsh-next-decisions

Added a private Decisions plugin to the main checkout, rather than the separate Squads worktree. Its native Models footer configures multiple provider endpoints, secret credentials, and per-provider Add model/Remove model rows for exact IDs. The native config editor persists these lists to the profile's `cordis.patch.yml` rather than a second settings file; it does not register a chat adapter or discover models. A narrow host decision interface and an explicit sample-choice test make the configured providers usable without implying agent execution or approval. The initial limits, ownership split, data handling, and first-run steps are described in [decisions.md](../../../docs/decisions.md) and the [package README](../../../packages/dsh-next-decisions/README.md).

The configuration and credential writes have optimistic revision checks and best-effort compensation. Isolated unit, contract, and keyless browser tests exercise the new plugin; they do not establish hosted Jev accuracy or make decisions available to Squads today. Squads adoption requires a separate consumer and its own freshness and authorization checks.
