# Open a changed file in its own tab, highlighted with its changed lines marked

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

Clicking a file under **Changes** no longer opens the diff inside the panel: it
opens a tab of its own that reads the whole file with syntax highlighting and
marks the lines that changed, the way the filesystem preview reads a file but
with the change visible in place. The panel's per-hunk view stays exactly where
it was, one row action away.

## How it is wired

The platform's stock file preview is a right-sidebar **tab type** registered at
the `fallback` band, so a plugin type can own an address family of its own. This
package now registers a second type beside its panel:

- `dsh-resource://git-changes/session/<sessionId>/<side>/<path>` is the address
  family (`core/address.ts` owns the grammar and reads it back; the session is
  in the address for the same reason the stock viewer keeps it there — the tab
  keeps meaning while the pane shows another session).
- `changeDefinition()` claims `dsh-resource://git-changes/**` at the inherited
  `extension` band and titles each chip after the file, noting `(staged)`.
- The body registers into the same keyed seat, under its own id, and renders
  `ChangeFileTab`.

The body fetches through one RPC, `getFileChanges`, which answers with the
displayed side's text, a grammar hint, and the change markers. The displayed side
is the side the diff is taken against — the worktree for `unstaged`, the index
copy for `staged` — and a path that is gone from that side is served from the
other side with every line marked removed, which is what the change did. A binary
change, a file past the read budget and a missing entry are named states rather
than empty ones.

## Marking the changed lines

`parseUnifiedDiff` now records, per hunk, the new-side line numbers it adds and
the positions a deletion sits before (a deletion has no line of the new file, so
it is a marker at the position it was removed from — `core/file-view.ts` merges
those into one ascending marker list). The tab paints `span.line` elements the
platform's code surface renders: a tint plus a `+`/`−` marker, and a
`data-change` attribute so anything outside the module can see the state without
knowing the hashed class name. A `MutationObserver` re-applies them when the
highlighter replaces the lines (a grammar finishing its load, a re-tokenize on
scroll), because the classes live on nodes React recreates.

The toolbar carries the file path and side, a `+`/`−` action that stages or
unstages every hunk of the file through the existing `inspectHunks` →
`applyHunks` pair bound to the previewed version, **Refresh** (read the file
again) and a wrap toggle. The panel's own diff keeps per-hunk staging and is now
opened by the row's **Review hunks** action, so nothing that existed before is
unreachable.

## Two React mistakes worth recording

Both were found by running the real shell, not by the unit tests:

1. **The framework's tab hook may only run during render.** Reading it inside the
   click handler threw React's "invalid hook call" (error #321), which the
   fallback swallowed into "the panel diff opened instead". The actions are now
   published by a tiny seat component (`TabActionsSink`) that reads the hook
   during render into a ref, and the handler reads that ref at click time.
2. **`useState` treats a function argument as an updater**, so publishing the
   opener through state called it immediately with the previous state and stored
   a boolean. The sink writes a ref instead — no state, no re-render loop, and no
   dependence on a callback identity that changes every render.

The swallowed error is what kept the first version hidden for a round: a failing
`openResource` now falls back to the panel diff, which is the right user
behaviour, but it took a temporary probe to see why.

## Verification

- Core: markers from real patches (added lines, deletions at the head and in the
  middle, a replacement on one line, several hunks merged, a synthesized new
  file), grammar hints against the platform's accepted aliases, and the address
  grammar round-trip including segments that would otherwise change it.
- Host: `getFileChanges` returns the text, grammar and markers for a modified
  file; serves a deleted file from the index with every line removed; is in the
  RPC method inventory; and defaults an unknown side to `unstaged`.
- Client: the tab reads its address, marks added and removed lines, re-marks them
  after the code surface replaces its lines, stages through the preview-bound
  pair (and unstages on the staged side), refreshes, toggles wrapping, and names
  binary, oversize, deleted, failed and invalid-address states. The panel tests
  cover the row opening the tab, the fallback to the in-panel diff without a tab
  hook, and the hunks row action.
- Full package suite 1,192 passed / one pre-existing filesystem skip; typecheck,
  build, `pnpm i18n:check`, `pnpm docs:check` (pair re-recorded) and
  `git diff --check` pass.
- The packed-plugin Git E2E lane drives all of it in a real mounted shell: the
  row opens the tab, the tab shows the file with `span.line[data-change="added"]`
  and an enabled hunks action, the panel tab still opens the per-hunk diff, and
  the run captured `media/change-file.webp` (cropped from that capture) which
  both README languages now show.

## A read that fails because the host half is older

The first real run of the tab showed "Could not read this file." A probe of the
running host explained it:

```
POST /dsh-next-git/rpc getFileChanges -> 404 no such method: getFileChanges
POST /dsh-next-git/rpc getDiff        -> 200 …
```

The client bundle is re-fetched on every page refresh while the host half loads
only when the process starts, so a new tab type can run against a host build
that predates its RPC. The API client now maps that 404 to a named
`host-outdated` failure (the route answers 404 only for an unknown method), and
both the panel and the change tab name it with its fix — restart the harness —
instead of reporting a generic read failure. Documented, tested in the API
client and the tab, and the reason this is worth a state rather than a message:
it has happened twice in this package's development already.

A tracked deletion is listed like any other change and the change view serves it
from the index (or the commit, when the deletion is already staged) with every
line marked removed; `getFileChanges` and the panel's list have regression tests
for both cases.

## The chrome is the preview's chrome

The first version read as a different surface: its own header height, a filled
band, a side pill and a plain summary line. The header and its parts now copy the
platform text preview's own values, taken from the installed
`dsh-client-ui-sidebar-documentpreview` bundle rather than from memory: a 38px
header with `padding: 0 6px 0 16px` and a 0.5px `border-l3` bottom edge, the
absolute path at 12px with directories in `label-tertiary` and the file name in
`label-primary`, the side as muted 12px text where the preview puts its viewer
name, 28px round tools (15px glyphs, `label-secondary` → `label-primary` on
hover), and the same `.changed` strip the preview grammar defines for a summary
(`bg-layer-2`, `border-l1` bottom edge, 6px/10px padding, 12px text). A path too
long for the row fades its leading directories behind the preview's own 28px
`mask-image` instead of being cut, so the file name stays readable.

The absolute path comes from the host (`FileChanges.absolutePath`, the repository
toplevel joined with the path), because the preview's header shows one and the
repo-relative path alone would have read as a different surface.

## The view opens on the changes

The changed-lines summary strip is gone (it repeated what the marks already say),
and the tab now opens in a **changed-lines view**: each change keeps three lines
of context, everything unchanged between distant changes is folded away, and the
first line after a folded stretch is drawn with a dashed top edge so the jump in
numbering is visible rather than confusing. A toggle beside the wrap control
(`Changed lines only`, on by default) shows the whole file instead. The model is
`hiddenLineNumbers` in `core/file-view.ts`; the hiding is applied to the rendered
lines the same way the change marks are, through data attributes and hashed
classes, and a file with no markers hides nothing.

Hiding lines exposed a numbering bug the real GUI showed immediately: the
primitive's gutter is a CSS counter, and `display: none` lines do not increment
it, so the visible subset restarted at 1 and the file's own line numbers were
lost. Every line now publishes its number as `data-line`, and one style rule
reads that attribute back into the gutter's `content`, which keeps the primitive's
geometry and correct numbering in both modes. A panel test pins the published
numbers, the jsdom tests pin the hidden set and the toggle, and the E2E lane
proves both modes on a 30-line file with one changed line (7 visible lines, one
gap edge, then 30 after the toggle).

## Square corners, and the rest of the preview's code layout

The code surface kept the primitive's own 12px radius and its opaque block fill,
so the language banner floated as a rounded card instead of the full-width band
the preview shows. The wrapper now copies the layout the platform's own code
renderer uses for a previewed file — `--dsl-code-block-border-radius: 0px`,
`--dsl-code-block-background: transparent` (the pane shows through), the
`[data-code-block-content]` node as the single scrollport with the `pre` left
`overflow: visible`, and `--dsl-code-block-line-white-space: pre` — with wrapping
turned on by a `data-wrap="true"` attribute, which is also how that renderer
spells it. The wrap tool therefore starts unpressed and turns wrapping on, the
same way the preview's does.

## The file content scrolls

A user-visible bug the unit tests could not see: a long file rendered past the
bottom of the pane and nothing scrolled. Measuring the real layout in the E2E
lane found it — `.codes` was correctly 824px with `overflow: hidden`, but the
code block inside it was **7668px** tall because a column flex item defaults to
`min-height: auto` and refuses to shrink below its content. The scrollport
therefore had nothing to scroll.

One declaration fixes it (`min-height: 0` on the block, which is what the
platform's own code renderer sets on its wrapper). The lane now proves it rather
than trusting it: after the whole-file toggle, the scrollport's `scrollHeight`
exceeds its `clientHeight`, setting `scrollTop` sticks, and the capture shows line
21+ under a pinned language banner. The general lesson is recorded here because
the same trap applies to any flex wrapper around a scrolling child.

## The chip says whose view it is

The tab chip now renders through a title seat of its own: the panel's branch
glyph, then the file name (and `(staged)` where that applies). Without it a tab
opened from Source control sat next to plain file previews under an identical
chip, and the two could not be told apart. The seat follows the panel's own rule
— never render nothing — so a record the shell has not committed yet still paints
a glyph and the type label, and the name is read from the tab's address rather
than from any store, which keeps it right before the first read lands.
