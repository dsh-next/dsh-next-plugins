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

- **Skills** — one card grid holding every skill in the global roots
  (`~/.dsh/skills` and `~/.agents/skills`) plus every provider catalog skill
  that is not already installed. Project/workspace skills are deliberately
  absent: they are hand-managed in the project and discovered natively by DSH,
  so this panel lists nothing it cannot manage. A relevance-ranked search box
  (name matches above description-only matches, so typing a skill's name
  surfaces it instead of alphabetically-earlier description hits), a provider
  filter, an installed-only toggle, and a Show more button (30 cards per page)
  keep large catalogs fast; changing the search returns to page one. A skill that exists in several roots shows **one
  card per copy**, so per-copy actions are unambiguous: each carries an origin
  chip (`user .dsh`, `user .agents`), the recorded provider spec, and per-copy
  **Delete** (recoverable), **Scopes**, **Providers**, and **Update**. Update
  refreshes the copy from its recorded provider only (same-name skills from
  other providers never show as updates, so the button cannot cycle between
  vendors). A name that is installed renders only its copy cards — every
  provider offering collapses into the copy's **Providers** button (labeled
  with how many providers offer the name). The source switcher lists Local
  plus each provider with its content parity ("matches your copy" / "differs
  from your copy"), marks the current source, and switching to a provider
  requires an overwrite confirm: the copy's files are rewritten in place,
  files that are not part of the provider copy are removed permanently (not
  moved to trash), and visibility scopes are kept. Choosing Local detaches the
  copy from its provider (files stay, updates stop) and applies directly.
  Externally-owned skills (installed by the cc-plugins bridge) show no
  Providers switcher — their source is the owning plugin's business. The
  **presence badge** (`Everywhere`, `N workspaces`, or `Off`) reflects the
  skill's scope, and clicking a name opens the full SKILL.md rendered as
  markdown. Installed skills sort first, and a name installed into several
  roots shares one bordered group box. The **Use/Scopes** button opens the
  scope modal: a radio picks where the skill is enabled — Global (the default,
  every workspace) or only in a checklist of registered workspaces — and
  installing or saving applies that scope as pure configuration.
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
plugin never writes skill files into a project — and it does not list, scope,
or manage project skills either: a workspace's `.agents/skills/` (or
`.dsh/skills/`) belongs to the project alone, hand-created and
version-controlled there.

**Enablement is configuration.** Per skill name, a scope setting decides
where the skill is enabled: absent means enabled in every workspace; a list
of workspace directory names enables it only inside workspaces whose folder
matches one of those names; an empty list disables it everywhere. Scopes
store folder names — not absolute paths — so the settings section keeps
working when teammates check the repos out somewhere else. (Two registered
workspaces sharing a folder name share their enablement.) The plugin publishes
the global-root skill catalog through its own `ctx.skills` provider (each
candidate one rank above the filesystem provider's equal entry) and resolves
the invocation flags per lookup from the scope — a disabled skill simply
carries both invocation flags off, so it disappears from every model and
command surface. Project skills stay with the native filesystem provider,
untouched by this config. No frontmatter edits, no shadow copies, no file
writes.

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

Deletion is recoverable: a copy's Delete button moves that copy into the
`.trash` directory of its root (skipped by discovery), so an accidental
removal can be undone by hand. Any copy in the global roots can be removed —
not just plugin-installed ones — and when the last copy of a name is removed,
the provenance record and scope entry are dropped together. Scope entries
whose name no longer resolves to any copy or catalog skill are pruned
automatically.

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
recipe used for catalog versions and compares it against every same-name
catalog skill. A copy's recorded provider drives the Update button: when its
content differs, Update rewrites the copy in place (pruning files that
disappeared upstream) and re-pins the provenance record, leaving the scope
untouched. Every other provider's offering — including adopting a
hand-managed copy — goes through the Providers source switcher, which
requires an explicit overwrite confirm before rewriting anything.
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
