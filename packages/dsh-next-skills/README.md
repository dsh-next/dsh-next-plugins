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

- **Skills** — one two-column card grid holding every discovered skill
  (project, custom, and user roots — cards that exist on disk come first,
  each group alphabetical) plus every provider catalog skill. A search box,
  a provider filter, an installed-only toggle, and a Show more button (30
  cards per page) keep large catalogs fast. Each card shows the name, the
  provider spec chip, the description, a presence badge (`Everywhere`,
  `N workspaces`, or `Off`), a `project` chip for hand-created project
  skills, and an orange `custom` chip for skills the plugin did not install.
  The **Add/Manage** button opens the scope modal: a radio picks where the
  skill is enabled — Everywhere (the default) or only in a checklist of
  registered workspaces — and installing or saving applies that scope as
  pure configuration. A managed card whose provider catalog moved ahead
  carries an **Update** button; the modal also hosts Update and a two-step
  Remove (managed skills only). Clicking a name opens the full SKILL.md
  rendered as markdown.
- **Providers** — manages GitHub skill repositories: add by URL
  (`https://github.com/owner/repo` or `owner/repo`), Refresh all, remove.
  Each row shows the repository description, the number of cached skills,
  the last sync age, and any sync error. Default providers seed on a fresh
  install and sync once shortly after boot; removals persist.

## How it works

**Global-only installs.** Installing copies a skill's files into the global
root (`~/.agents/skills/<name>/`) and records it in settings. The plugin
never writes skill files into a project; a workspace's `.agents/skills/`
(or `.dsh/skills/`) is scanned read-only so hand-created, version-controlled
project skills appear in the grid with a `project` chip.

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

**Settings-backed state.** Providers, installed records, and scopes persist
in the plugin's own namespace of the harness settings file
(`$DSH_HOME/settings.yaml`, key `dsh-next-skills:`) — readable, hand-editable,
and easy to share between developers. After the provider caches sync, a skill
recorded in settings whose files are missing is reinstalled from the cache, so
copying the settings section to a teammate (or a new machine) reproduces the
same skill set.

Removal is recoverable: confirming the modal moves a managed skill into the
`.trash` directory of its root (skipped by discovery), so an accidental
removal can be undone by hand. Hand-created skills are never removed by the
plugin. A first launch migrates the pre-settings state (providers.json,
frontmatter toggles, workspace shadow copies, workspace installs) into the
settings section: managed workspace copies move into the global root,
shadows are deleted, and previously disabled skills start as an explicit
"enabled nowhere" scope.

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
root and records a small manifest (`.dsh-next-provider.json`) alongside the
settings record.

**Fast syncs via repository snapshots.** Instead of one request per file, a
sync downloads the repository's default-branch snapshot in a single request
(`codeload.github.com`, CDN-backed and outside the API rate limit), extracts
it in memory, and copies out every `SKILL.md` directory. Skill versions are
content hashes, so a refresh re-copies only skills whose files changed.
Metadata (repository description and star count) comes from one cheap API
call. That keeps even large default providers well within GitHub's 60
req/hr unauthenticated budget and makes first syncs a matter of seconds.

**Change detection** compares those content-hash versions against the version
recorded for an installed skill: when they differ, its card shows an Update
button; updating overwrites the files (pruning ones that disappeared
upstream), keeps the manifest and the settings record current, and leaves the
scope untouched. Refresh is manual (per provider or Refresh all) and
detect-only: nothing is installed or overwritten without a click.

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
