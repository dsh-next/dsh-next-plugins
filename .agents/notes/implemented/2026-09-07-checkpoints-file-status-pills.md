# Checkpoints file-status pills

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

File list rows now lead with a Created / Deleted / Modified pill (success /
error / warn fills, near-black label). The old right-side Created/Deleted
caption is gone. Deleted paths use tertiary color plus strikethrough. Removed
line counts use `--dsw-alias-state-error-primary`; `--dsw-alias-label-error`
is not a theme token, which is why `-N` was inheriting white.

Surfaces: Checkpoints file list (conversation.view). Token set: success /
error / warn primary fills, static near-black label, label-tertiary for
deleted paths. Geometry: 10/14 pill, 999 radius, 0 5px padding (a step
under the shell 11/17 chip so they do not dominate the file name). Control
grammar unchanged. Dictionary: `file.modified`.
