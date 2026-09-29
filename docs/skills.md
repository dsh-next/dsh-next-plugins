# Skills: sources, updates, and recovery

The [plugin README](<../packages/dsh-next-skills/README.md>) covers installation
and a first skill. A provider is a public GitHub repository that supplies skill
files; an installed copy is the version stored on your machine.

## Find the right copy

`Settings` → `Skills` combines installed copies from the global Harness and
agents skill roots (normally `~/.dsh/skills` and `~/.agents/skills`) with
uninstalled provider skills. Each copy has a separate card and origin label,
even when several copies share a name. Project skills are not listed or managed.

Search ranks name matches first. Use the provider filter or `Installed only`
to narrow results; `Show more` displays another 30 cards. Select a name to read
its instructions before installing. An install writes directly to the global
agents root, normally `~/.agents/skills/<name>/`.

Harness's native discovery determines which skills are visible and which copy
takes precedence. The plugin does not override that selection or invocation
flags such as `disable-model-invocation` and `user-invocable` in a skill's metadata.

## Add or refresh a source

In `Providers`, add a public GitHub repository as `owner/repo` or a GitHub URL.
Skill directories can be nested at any depth; `.git`, `.github`, and
`node_modules` are skipped. Default providers are added on first launch and
synced shortly after boot. Removing a default provider persists.

`Refresh all` syncs sources one at a time, showing progress and per-provider
errors. A failed source does not stop later sources; use `Refresh all` to retry.
If GitHub metadata requests hit rate limits, set `DSH_GITHUB_TOKEN` or
`GITHUB_TOKEN` in the Harness process environment and refresh again.

The catalog cache under `$DSH_HOME/skills-market/` does not activate skills.
Refreshing checks for updates without overwriting existing installed directories.
It can restore missing recorded installs as described below.

## Update or change a skill's source

**Back up any local edits and extra files first.** Updates and provider switches
rewrite the copy in place. Files absent from the provider's version, including
local additions, are permanently removed rather than moved to trash.

- `Update` uses the copy's recorded provider, not another provider's same-name
  skill.
- `Providers` shows alternative sources and whether they match the installed
  copy. Switching requires an overwrite confirmation.
- `Local (hand-managed)` detaches the copy from provider updates without
  changing its files.

## Delete a copy or recover missing files

`Delete` moves the copy into its own skill root's `.trash` directory for manual
recovery, including hand-managed copies. Deleting the last copy of a name also
removes its installation record.

Provider settings and the `installations` provenance ledger are stored in the
active profile's `cordis.patch.yml`, under `dsh-next-skills`. After boot-time sync
and each `Refresh all`, the plugin uses available provider cache contents to
restore missing recorded global agents-root installation directories. Existing
directories are not overwritten.

Consequences:

- Sharing the configuration row can recreate recorded provider installs on
  another machine after sync.
- Deleting files manually but leaving their record may reinstall the skill.
  Remove it through the UI when you want it gone.
- Trash recovery from `Delete` does not recover local files removed by an
  earlier update or provider switch.

## Open an installed skill's folder

Select the skill's name, then the app icon beside the dialog title. The arrow
lists supported apps detected by Harness, such as Finder or VS Code. Your
choice is remembered in this browser. A flat Markdown skill opens its containing
folder.

![Skill details with a menu of folder-opening apps](<../packages/dsh-next-skills/media/skills-folder.webp>)

The control is hidden while apps load, when none are supported, when the native
opener is unavailable, and for uninstalled catalog entries. A failed launch
leaves the dialog open for retry. The app runs on the machine hosting Harness,
not necessarily the machine displaying your browser.

## Upgrade from the old scope controls

Upgrading preserves skill files, providers, and installation records. The old
`dsh-next-skills.scopes` settings are ignored and removed on the next settings
save. Previously disabled or workspace-restricted **global** skills become
globally available, subject to their invocation flags.

There are no per-skill scope or enable/disable controls. Install requests no
longer interpret or validate old scope fields; every install is global. Project
copies in `.agents/skills/` and `.dsh/skills/` are not moved or deleted: they stay
hand-managed and follow native discovery.

For development and testing, see [Contributing](<../CONTRIBUTING.md>).
