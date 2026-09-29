# Documentation rules

This file governs the documentation in this repository.

## Conventions

- Documentation is written in English only. Package READMEs are the one
  exception: they are maintained as bilingual English/Chinese pairs under the
  contract in `docs/i18n.md`.
- Keep each fact in its owning document; do not duplicate facts across files.
- Update documentation in the same change that changes behavior.
- Put temporary handoffs, decisions, and validation snapshots in
  `docs/archive/`.

## Required files

- Every package has a bilingual README pair (`README.md`, `README.zh.md`, and
  the `README.i18n.yaml` pairing record). Pairing, switchers, and GitHub vs
  npm links live in `docs/i18n.md`. What the README must contain is below.
- Repository-level rules live in `AGENTS.md`; contributor guidance in
  `CONTRIBUTING.md`.

## Package READMEs

A package README is a first-run guide for someone who is not a contributor
and is not a git expert. Local development belongs in
[CONTRIBUTING.md](../CONTRIBUTING.md), not in the package README.

### Audience and tone

- Write for someone who uses Harness but does not know the plugin or its
  implementation. Explain necessary terms at first use: a worktree is a separate
  working folder; staging means choosing changes for a commit.
- Lead with the user's benefit, not the architecture. Use direct verbs such as
  "Open", "Choose", and "Save". Prefer "you" to "we" and avoid "simply", "just",
  promotional claims, and promises that a tool cannot guarantee.
- Keep sentences short and give each paragraph or bullet one main idea. A
  numbered step should be an action, not a paragraph of unrelated options.
- Keep on-screen labels in their shipped English form inside inline code,
  including in Chinese READMEs (`Rewind`, `Save`). Do not invent UI labels.
- Use bullets for independent features or cautions and numbered lists only when
  order matters. Do not turn a long paragraph into an equally long bullet.
- Aim for roughly 200–400 English words; a narrow utility may need fewer.
  This is a local editing target, not a hard limit or an external standard.
  Never omit setup, cost, security, or data-loss warnings to meet it. Chinese
  mirrors the meaning and structure, not an English word count.

### Shape

Keep the following order, with sentence-case headings:

1. **Title and one-sentence pitch.** Name the plugin in plain language and say
   what it helps you do. Keep the required language switcher below the title.
2. **Install.** State prerequisites and release availability, show one npm
   installation command, and explain the profile placeholder. Do not make
   readers scroll past a feature catalog to get started.
3. **Quick start.** Give 3–5 short steps for one useful task, ending with the
   visible result. A passive utility may need fewer. Put a warning before the
   action that could destroy work, send private data, or incur charges.
4. **What you can do.** Use 3–5 short, benefit-led bullets, not an inventory of
   every control. Include one useful screenshot (two if they explain different
   tasks). Keep existing extra screenshots in the detailed guide rather than
   deleting the assets. A plugin with no UI needs no invented screenshot.
5. **Good to know.** Keep essential limitations and surprising defaults visible.
   Link to a task-focused guide, help, and contributor instructions as needed.

### Keep depth out of the first-run path

- Move configuration schemas, option tables, recovery recipes, protocol details,
  and exhaustive workflows into an owning guide under `docs/`. Use descriptive
  links such as "Worktree setup and history safety", not "click here".
- Preserve useful facts when shortening an existing README. Move advanced
  material rather than silently dropping it; remove repetition and obsolete
  claims. Existing guides take precedence over creating another source of truth.
- Do not hide essential warnings inside collapsed sections or only in a linked
  guide. The README must still explain destructive updates, global scope,
  provider charges, and unreleased status when applicable.
- No development command blocks in package READMEs. Link to the repository's
  [contributor guide](<../CONTRIBUTING.md>) instead. External-to-package links
  use GitHub blob URLs; image paths and language switchers follow the
  [bilingual contract](<i18n.md>).
- A screenshot supports instructions; it never replaces them. Use descriptive
  alt text and avoid long galleries, badge walls, and decorative images.

Research and examples behind this approach are collected in the documentation
skill's [README writing reference](<../.agents/skills/dsh-next-documentation/references/readme-writing.md>).

### Install

Always the npm package name. Never `link:`, `file:`, or a checkout path —
those belong in [CONTRIBUTING.md](../CONTRIBUTING.md) and the
`dsh-next-local-testing` skill, not the package README. A package that is
still `"private": true` shows this form only as the future installation command,
with a clear private/unreleased notice before it. Never imply it is available
on npm now.

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-<slug>
```

Explain that `<name>` is the DSH profile (for example `web`).

### Screenshots

A plugin that ships browser UI includes screenshots of the real GUI:

- Dark theme, cropped to the control, looking like a real project (not
  `workspace-a` / `cobalt-01` fixtures, not a failed API-key turn).
- Store files in `packages/dsh-next-<slug>/media/`.
- Encode as WebP at **1x the width they display at** in the README
  (GitHub's reading column is about 888px; a sidebar crop is ~360px, a
  modal ~400px, a full-column diagram ~720px). Do not ship 2x retina
  copies.
- Relative markdown: `![alt](media/loop.webp)`.
- Add `media` to that package's `package.json` `files` list.
- Set `repository.directory` to `packages/dsh-next-<slug>` so npmjs.com
  rewrites those relative images (see `docs/i18n.md`).
- Prefer a WebP diagram over Mermaid: GitHub renders Mermaid, npmjs.com
  does not.

Composite related states (icon colors, a merge flow) into one image when
that is clearer than a gallery.

## Validation

Run `pnpm docs:check` before merging to verify the documentation contract.
