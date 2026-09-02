# @dsh-next/dsh-next-skills

English | [中文](README.zh.md)

DeepSeek Harness plugin that manages agent skills from the Web GUI: add
GitHub repositories as skill providers, install their skills globally, and
control per workspace — through configuration — which skills are enabled
where. Skills install once, into the global skill root; projects keep only
hand-created, version-controlled skills, and enable/disable never writes
skill files.

A **Skills** section appears in the main settings navigation (the same level
as General, Models, and Plugins — registered through the official
`settings.section` slot), styled after the Claude Plugins page, with two
tabs:

- **Skills** — one two-column card grid holding every discovered skill across
  the project and user roots (`.dsh/skills` and `.agents/skills`, each scanned
  for the current workspace and globally) plus every provider catalog skill. A
  search box, a provider filter, an installed-only toggle, and a Show more
  button (30 cards per page) keep large catalogs fast. A skill that exists in
  several roots shows one card per **name** with a copy row per location —
  each copy carries an origin chip (`project .agents`, `user .dsh`, …), the
  absolute path, and per-copy **Delete** (recoverable) and **Update** (when a
  same-name catalog skill differs) buttons; the name-level **presence badge**
  (`Everywhere`, `N workspaces`, or `Off`) reflects its scope. An **Update
  all** button in the filter row shows how many updatable copies there are,
  sits disabled at zero, and updates them one at a time. The **Add/Manage**
  button opens the scope modal: a radio picks where the skill is enabled —
  Global (the default, every workspace) or only in a checklist of registered
  workspaces — and installing or saving applies that scope as pure
  configuration. Clicking a name opens the full SKILL.md rendered as markdown.
- **Providers** — manages GitHub skill repositories: add by URL
  (`https://github.com/owner/repo` or `owner/repo`), Refresh all, remove.
  Each row shows the repository description, the number of cached skills,
  the last sync age, and any sync error. Refresh all runs one provider at a
  time: the downloading row swaps its Remove button for a spinner reading
  "Refreshing…" until the next provider starts (so the active provider is
  always identifiable), the button shows the progress ("Refreshing 2/9…"),
  and a failing provider shows its error on its own row while the rest
  continue. Default providers seed on a fresh install and sync once shortly
  after boot; removals persist.

## How it works

**Global-only installs.** Installing copies a skill's files into the global
root (`~/.agents/skills/<name>/`) and records the provenance in settings. The
plugin never writes skill files into a project; a workspace's `.agents/skills/`
(or `.dsh/skills/`) is scanned read-only so hand-created, version-controlled
project skills appear in the grid too.

**Enablement is configuration.** Per skill name, a scope setting decides
where the skill is enabled: absent means enabled in every workspace; a list
of workspace directory names enables it only inside workspaces whose folder
matches one of those names; an empty list disables it everywhere. Scopes
store folder names — not absolute paths — so the settings section keeps
working when teammates check the repos out somewhere else. (Two registered
workspaces sharing a folder name share their enablement.) The plugin publishes
the skill catalog through its own `ctx.skills` provider (each candidate one
rank above the filesystem provider's equal entry, so project skills still
outrank same-name global ones) and resolves the invocation flags per lookup
from the scope — a disabled skill simply carries both invocation flags off,
so it disappears from every model and command surface. No frontmatter edits,
no shadow copies, no file writes.

**Settings-backed state.** Providers, the install-provenance ledger
(`installations`), and scopes persist in the plugin's own namespace of the
harness settings file (`$DSH_HOME/settings.yaml`, key `dsh-next-skills:`) —
readable, hand-editable, and easy to share between developers. That section
is the single source managing the plugin's state: a provider exists because
the section lists it, and a skill's provenance is whatever the section
records — never a cache file or a per-skill sidecar (the provider catalog
cache under `$DSH_HOME/skills-market/` is a replica: a cache entry without a
settings record does not exist as far as the panel is concerned). After the
provider caches sync, a skill recorded in settings whose files are missing is
reinstalled from the cache, so copying the settings section to a teammate (or
a new machine) reproduces the same skill set: providers configure immediately,
the first boot syncs the caches and installs the recorded skills, and scopes
apply as-is (they are folder names). Every Refresh all ends with the same
reconcile, so a provider that failed during a first boot's sync self-corrects
on the next refresh.

Deletion is recoverable and universal: a copy's Delete button moves that
copy into the `.trash` directory of its root (skipped by discovery), so an
accidental removal can be undone by hand. Any `.dsh`/`.agents` copy can be
removed — not just plugin-installed ones — and when the last copy of a name
is removed, the provenance record and scope entry are dropped together.
Scope entries whose name no longer resolves to any copy or catalog skill are
pruned automatically.

## Providers and the cache

A provider is any public GitHub repository containing skills: any directory
with a `SKILL.md` counts, at any depth, so both flat layouts
(`skills/<name>/SKILL.md`, e.g. vercel-labs/skills) and nested ones
(`native-skills/default/<group>/<name>/SKILL.md`, e.g. holistics/skills) work.
`.git`, `.github`, and `node_modules` subtrees are ignored.

On first launch the plugin seeds a set of default providers (anthropics/skills,
openclaw/openclaw, mattpocock/skills,
muratcankoylan/Agent-Skills-for-Context-Engineering, affaan-m/ecc,
nextlevelbuilder/ui-ux-pro-max-skill, addyosmani/agent-skills,
Leonxlnx/taste-skill) and syncs them once shortly after boot, so the Skills
tab is populated without any setup. Removing a default persists — they never
come back.

**Rate limits.** Metadata calls authenticate with `DSH_GITHUB_TOKEN` or
`GITHUB_TOKEN` (either environment variable, read again on every sync) when
set — 5000 requests/hour instead of the 60/hour unauthenticated budget the
whole machine shares. The snapshot download itself is CDN-backed and outside
that budget either way.

Adding a provider downloads every skill into a plugin-owned cache at
`$DSH_HOME/skills-market/` — deliberately outside `$DSH_HOME/skills`, which the
DSH filesystem provider scans, so cached skills never activate by themselves.
The Skills tab reads that cache; installing copies the files into the global
root and records the provenance in settings. A provider may expose any number
of skills — there is no cap (the grid paginates, and syncing is content-hash
incremental), so even repositories with hundreds of skills sync and browse
fine.

**Fast syncs via repository snapshots.** Instead of one request per file, a
sync downloads the repository's default-branch snapshot in a single request
(`codeload.github.com`, CDN-backed and outside the API rate limit), extracts
it in memory, and copies out every `SKILL.md` directory. Skill versions are
content hashes, so a refresh re-copies only skills whose files changed.
Metadata (repository description and star count) comes from one cheap API
call. That keeps even large default providers well within GitHub's 60
req/hr unauthenticated budget and makes first syncs a matter of seconds.

**Change detection** fingerprints each local copy with the same content-hash
recipe used for catalog versions and compares it against same-name catalog
skills: when they differ, the copy's card shows an Update button (with a
provider picker when several providers offer the name); updating overwrites
the copy in place (pruning files that disappeared upstream) and adopts the
name into the settings provenance record, leaving the scope untouched.
Refresh is manual (Refresh all) and detect-only: nothing is installed or
overwritten without a click.

## Install

```sh
dsh plugin --profile <name> add link:<repo>/packages/dsh-next-skills
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Run the real-mount smoke from the repository root with `mise run e2e`.
