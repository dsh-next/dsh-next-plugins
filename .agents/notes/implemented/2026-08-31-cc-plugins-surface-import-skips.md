# cc-plugins: surface settings imports a machine cannot satisfy

- date: 2026-08-31
- status: implemented
- scope: packages/dsh-next-cc-plugins

Answering "what if somebody doesn't have the same workspaces": the import
already skips those targets safely (marketplaces and global targets still
import; nothing is silently redirected), but the skip reason lived only in
the host log — a user of a shared settings file could not see why a plugin
was missing. `CcState` gained `importSkipped: string[]` (the last
reconcile run's skip notes, kept on the service and stamped by
`reconcileFromMirror`), and the Plugins tab renders a
`cc-import-skipped` notice listing them with the recovery hint (add the
workspace or install through the panel). A machine that satisfies
everything sees no notice.

## Verification

251 tests across 15 suites (was 250): a panel test rendering the notice
with the exact missing-workspace note and its absence when imports
succeed, a service assertion that state carries the reconcile skip notes,
and the RPC envelope pinning the new field.
