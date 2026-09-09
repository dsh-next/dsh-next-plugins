# Fail-closed workflow fixtures and mount guards

- date: 2026-09-09
- status: implemented
- scope: scripts, tests/e2e, playwright.config.ts

Workspace seeding preserves argv boundaries, rejects corrupt registries, and publishes atomic registry replacements only for stopped scratch runtimes. The import-safe helper exposes `seedWorkspaces(home, directories)` for the orchestrator. Runtime dependency discovery includes existing tracked and untracked source using NUL-delimited Git output, excluding deleted files without restoring them.

Mount interactions now run as named steps with health checks after each marker. Crash prefixes use the bare ID once; checkpoint markers create a known session and require both tab and panel instead of conditionally passing. Node regression tests execute these guards with missing UI, real crash prefixes, and late errors. No expected-error exemptions were introduced.

Detailed checkpoint capture asserts newest-first DOM IDs and chronological host IDs and writes a screenshot through `test.info().outputPath`. Helpers use portable select-all shortcuts. Playwright retains failure traces/screenshots locally and disables in-process retries; workers remain one. The parent orchestrator owns fresh-runtime suite retries and real E2E verification.
