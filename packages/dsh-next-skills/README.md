# Skills for DeepSeek Harness

English | [中文](README.zh.md)

Browse and install reusable agent instructions, called skills, from GitHub without leaving Harness.

## Install

Requires DeepSeek Harness `0.1.7-alpha.1` or newer.

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-skills
```

Replace `<name>` with your DSH profile, for example `web`, and open that profile's Web GUI.

## Quick start

1. Open `Settings` → `Skills` and wait for the default catalogs to load.
2. Search for a skill. Click its name to read the instructions before installing; choose sources you trust.
3. Click `Install`. The skill becomes available across workspaces, subject to its own invocation settings—not just in this project.
4. To check for updates, open `Providers` and choose `Refresh all`. This checks the catalog without replacing existing copies. **Back up local edits before choosing `Update`: updating can permanently remove them.**

## What you can do

- **Find skills:** search catalogs and filter by provider or `Installed only`.
- **Add sources:** open `Providers` and add a public GitHub repository, such as `owner/repo`.
- **Manage installed copies:** update a skill, switch its source, or choose `Local (hand-managed)` to stop provider updates.
- **Read and open files:** inspect a skill's instructions and open its folder in a supported app when available.

![Skills settings with searchable skill cards and provider controls](<media/skills.webp>)

## Good to know

- Installs are global, normally under `~/.agents/skills`. This page does not manage project skills or offer per-workspace enable switches.
- Upgrading from the old scope controls makes previously disabled or restricted global skills globally available. Skill invocation settings still apply.
- Updates and source switches overwrite the copy, including removing local additions without trash recovery. `Delete` instead moves a copy to its skill root's `.trash` folder.
- Deleting installed files by hand may trigger reinstallation on refresh. Use `Delete` in the UI to remove the recorded install.
- Folder-opening apps run on the machine hosting Harness, which may not be your browser's machine.

[Sources, updates, and recovery](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/skills.md>) · [Get help](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [Contributing](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
