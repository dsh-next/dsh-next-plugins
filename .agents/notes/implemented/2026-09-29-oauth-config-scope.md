# Isolate OAuth provider config persistence

- date: 2026-09-29
- status: implemented
- scope: packages/dsh-next-oauth-providers

Moved legacy settings migration reads and config-editor write settlement into a host config-scope module. The host entry now wires the scope alongside the adapter and provider directory; existing host apply tests continue to cover migrated rows, resolved sections, writes, and teardown. No configuration or runtime behavior changed. The owning E2E helper also retries opening Models after the shell's delayed testing notice; without that guard a cold browser could time out before exercising the plugin. The package already has a pending changeset for its separate user-facing changes.
