# Make plugin READMEs short first-run guides

- date: 2026-09-29
- status: implemented
- scope: plugin README pairs, docs, dsh-next-documentation skill

Rewrote all seven plugin README pairs around installation, one first task,
short feature lists, and essential cautions. Advanced settings and recovery
information now live in linked task guides instead of crowding first use.
Private packages are explicitly marked unreleased; safety, global scope,
credential, and provider-cost limitations remain visible.

The [canonical README rules](<../../../docs/AGENTS.md#package-readmes>) own the
new structure. The [documentation skill](<../../skills/dsh-next-documentation/SKILL.md>)
adds fact-checking, content triage, bilingual review, and a fresh-reader check.
Its [research reference](<../../skills/dsh-next-documentation/references/readme-writing.md>)
records the sources and selected examples, including what not to copy.

Detailed task guides: [Git](<../../../docs/git.md>),
[OAuth providers](<../../../docs/oauth-providers.md>),
[Checkpoints](<../../../docs/checkpoints.md>),
[Notifications](<../../../docs/notifier.md>),
[Skills](<../../../docs/skills.md>),
[Decisions](<../../../docs/decisions.md>), and
[OpenCode session patch](<../../../docs/opencode-session-patch.md>).

Added real dark-theme [Checkpoints](<../../../packages/dsh-next-checkpoints/media/checkpoints.webp>)
and [OAuth sign-in](<../../../packages/dsh-next-oauth-providers/media/provider.webp>)
screenshots from isolated scratch profiles, and included their media directories
in the corresponding package allowlists. Existing screenshots remain available.

No runtime behavior is changed by this documentation work. Existing uncommitted
plugin changes are preserved. README translations are reviewed together before
refreshing their pairing records; documentation checks verify the recorded pairs.
