# Align workspace SDK consumers with DSH 0.1.7

- date: 2026-09-24
- status: implemented
- scope: workspace SDK dependencies, checkpoints, notifier, skills

The checkout was mixing SDK 0.1.2/0.1.6 and 0.1.7 type graphs after the cc-plugins and OAuth adapters moved to 0.1.7; the old slots package could not augment the current settings UI. The workspace manifests now resolve the available 0.1.7-rc.1 packages (client-runtime remains on its published 0.1.1-rc.2).

The checkpoints rewind notice and Git drafting prompt have their own `MessageSourceMap` kinds instead of the removed generic `plugin` kind. Notifier now types its local config editor adapter with the small face it consumes rather than the removed exported `SettingsScope`, and its subprocess mocks implement the current handle shape. Git's diff labels and session test fixtures match the current UI/client SDK; skills tests model the new native menu's ResizeObserver and additional placement frame without weakening the retired-focus assertion.

The 0.1.7 UI-primitives bundle references several undeclared runtime dependencies. `pnpm-workspace.yaml` adds a version-scoped `packageExtensions` entry for the imports used by its published bundle; this keeps pnpm's virtual-store resolution explicit rather than relying on hoisting.

Checkpoints (141), notifier (322), skills (337), cc-plugins (402), OAuth (282), OpenCode patch (13) and Git (1715 plus one skipped) passed individually after the dependency and test updates. Workspace-wide build and real-mount E2E verification remain to be recorded after Git's SDK type port. Do not treat this note as a live Codex tool-call verification.
