# Git runtime registration and process startup hardening

- date: 2026-09-23
- status: implemented
- scope: packages/dsh-next-git and the keyless E2E profile fixture

The Git host now retains repository/RPC availability when the settings service does not support registration. Drafting preferences are stored in the plugin's Loader config through the Host `configEditor` service when the settings scope is read-only; a writable settings scope remains the preferred path. The plugin exports a Config schema for its drafting preferences, and the E2E profile fixture includes the config-editor service needed to exercise that path. The lifecycle tests also allow for process scheduling contention before a spawned hook writes its readiness marker.

The repository submenu no longer clips its nested card: the parent menu allows visible overflow while the custom placement hook clamps and repositions the submenu. The real Git E2E verifies the submenu receives pointer events, plugin settings persist across reopening, and the full repository interaction flow completes.
