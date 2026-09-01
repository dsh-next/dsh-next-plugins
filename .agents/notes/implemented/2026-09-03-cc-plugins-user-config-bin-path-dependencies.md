# cc-plugins parity tranche: user_config, bin on PATH, dependency auto-install

- date: 2026-09-03
- status: implemented
- scope: packages/dsh-next-cc-plugins

## What

Three Claude Code parity fixes from the compatibility audit, all
bridge-local:

1. **`${user_config.<key>}` MCP template expansion.** The Grafana-class
   failure mode (managed row carrying literal
   `${user_config.grafana_url}`, server panicking at boot) is gone:
   `McpTemplateVars.userConfig` resolves the namespace at install/update
   time, with the composition's `runtime.userConfig` as baseline and the
   hand-editable `$DSH_HOME/cc-plugins/user-config.json` overriding key
   by key (`Store.readUserConfig`). Unconfigured keys stay literal with
   a note naming both configuration points. The template token regex now
   accepts dotted names (`user_config.x` never matched before — the
   literal pass-through was the bug's enabler).

2. **`bin/` on PATH for hook commands.** `hookEnv(baseEnv, pluginRoot)`
   (pure, in `host/hook-runner.ts`) prepends `<pluginRoot>/bin` to PATH;
   `nodeHookRunner` runs every hook through it. Hooks invoking plugin
   executables by name now resolve, as in Claude Code. `bin/` stays in
   the counted unbridged families on cards (it is not installed
   anywhere), but the README notes the PATH behavior.

3. **Dependency auto-install.** `plugin.json` `dependencies`
   (`name` / `name@range`, `parseDependency` in plugin-inventory.ts)
   resolve from the same marketplace after the parent record persists:
   missing dependencies install alongside, inheriting the parent's
   scope; already-installed ones satisfy silently; missing entries,
   range mismatches (`satisfiesRange` in versions.ts — `^` `~` `>=` `=`
   exact `*` over the loose dotted parser, unparseable versions satisfy
   only exact matches), self-references, and failed installs skip with
   notes and never fail the parent. Cycles need no guard: the parent
   persists first, so a chain back to it hits the installed check. The
   declaration persists on the record (`requires:`); update/uninstall of
   dependencies stays explicit, like Claude.

## Verification

- 376 package tests: `hook-runner.spec.ts` (new, pure env composition),
  `satisfiesRange` coverage, `parseDependency`, user_config expansion
  (mcp-rows.spec resolved/unresolved), service-level config-vs-file
  precedence and dependency flows (auto-install with scope inheritance,
  silent satisfaction, all three skip notes).
- README pair updated (MCP template bullet, unbridged families, hooks
  table row, dependencies bullet, config yaml) and re-paired; docs and
  i18n gates green; mount smoke green.
