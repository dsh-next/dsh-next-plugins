# @dsh-next/dsh-next-skills

DeepSeek Harness plugin that manages agent skills from the Web GUI: add
GitHub repositories as skill providers, search their skills locally, and
install them globally or per workspace.

A **Skills** section appears in the main settings navigation (the same level
as General, Models, and Plugins — registered through the official
`settings.section` slot) with three tabs:

- **Installed** — lists skills discovered from the DSH skill roots. Each row
  shows the title with a right-aligned scope chip (`⭐ Global` or the owning
  workspace's name, plus `· disabled` / `· shadow` markers), the provider name
  in a chip under the title (or an orange `custom` chip when the skill was not
  installed from a provider), the description, and a button row below it:
  Enable/Disable (red `Disable` while enabled, green `Enable` when off),
  Remove behind a confirmation popup, Update (always visible, disabled while
  the skill is current), and Update all copies when several copies are
  outdated. A disabled skill dims only its title and description.
- **Search** — searches the skills cached from every provider (offline and
  instant), with a search bar, a provider filter dropdown, and an
  install-target selector (global or a specific workspace). Results load
  progressively (infinite scroll, 30 at a time) so large catalogs stay fast.
  Each row shows
  where the skill is already installed (`in global`, `in 2 workspaces`, …) and
  offers Install per target, so the same skill can live in several workspaces
  independently. Clicking a skill opens a detail modal with its full SKILL.md
  configuration: name, description, invocation flags, and the markdown body
  (installed rows open the same modal for their copy).
- **Providers** — manages GitHub skill repositories: ships with default
  providers on first launch (removable), add more by URL
  (`https://github.com/owner/repo` or `owner/repo`), refresh one provider or
  all, remove. Each row shows the repository description, its star count
  (`★`), and the number of cached skills.

## How it works

The plugin manages the same on-disk skill roots the DSH filesystem skill
provider scans, so changes take effect for the running agent without a restart:

| Scope | Root |
| --- | --- |
| workspace | `<workspace>/.agents/skills/` (and `.dsh/skills/`) |
| global | `~/.agents/skills/` (and `$DSH_HOME/skills/`) |

Enable/disable uses the native SKILL.md frontmatter flags
(`disable-model-invocation`, `user-invocable`). Per-workscope behavior:

- **Install per workspace** — installing with a workspace target writes an
  independent copy into that workspace's root; other copies are untouched.
- **Disable per workspace** — with a workspace selected, toggling a global
  skill off drops a workspace *shadow* copy (ranked above the user root) that
  disables it there only; the row is badged `shadow` and toggling back on
  removes the shadow. Select "Global only" to toggle the global copy itself.
- **Delete per workspace** — with a workspace selected, Remove trashes only
  that workspace's copy; the global copy and other workspaces keep theirs.
- **Update everywhere** — a skill installed in several places can be updated
  one copy at a time, or all at once with Update all copies: the global copy
  and every workspace copy are refreshed in a single call, each keeping its own
  enable/disable state (copies that are not provider-installed or are shadows
  are skipped and reported).

Removal is recoverable: confirming the popup moves the skill into the `.trash`
directory of its own root (skipped by discovery), so an accidental removal can
be undone by hand; plugin-generated workspace shadows are deleted outright.
The same popup guards provider removal (the cache is deleted; installed skills
stay).

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
Leonxlnx/taste-skill) and syncs them once shortly after boot, so the Search
tab is populated without any setup. Removing a default persists — they never
come back.

Adding a provider downloads every skill into a plugin-owned cache at
`$DSH_HOME/skills-market/` — deliberately outside `$DSH_HOME/skills`, which the
DSH filesystem provider scans, so cached skills never activate by themselves.
The configured provider list persists next to the cache (`providers.json`).
The Search tab reads that cache; installing copies the files into the
chosen skill root and records a small manifest (`.dsh-next-provider.json`)
recording the provider and the installed version.

**Fast syncs via repository snapshots.** Instead of one request per file, a
sync downloads the repository's default-branch snapshot in a single request
(`codeload.github.com`, CDN-backed and outside the API rate limit), extracts
it in memory, and copies out every `SKILL.md` directory. Skill versions are
content hashes, so a refresh re-copies only skills whose files changed.
Metadata (repository description and star count) comes from one cheap API
call. That keeps even large default providers well within GitHub's 60
req/hr unauthenticated budget and makes first syncs a matter of seconds.

**Change detection** compares those content-hash versions against the version
recorded in an installed skill's manifest: when they differ, the Installed tab
shows an Update button; updating overwrites the files (pruning ones that
disappeared upstream), keeps the manifest current, and re-applies your
enable/disable state so a disabled skill stays disabled. Refresh is manual
(per provider or Refresh all) and detect-only: nothing is installed or
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
