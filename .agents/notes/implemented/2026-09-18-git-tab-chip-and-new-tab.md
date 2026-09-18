# Git tab: the chip never goes blank, and what New tab really does

- date: 2026-09-18
- status: implemented
- scope: packages/dsh-next-git, tests/e2e

Two reports from the running shell: a Source control tab whose chip text was
sometimes empty, and a New tab click that appeared to close that tab.

## The blank chip

The live title seat could render nothing, and the chip then showed an empty
pill. Two ways out of that were removed:

- The title registration returned `null` whenever the slot framework handed it
  no `useTabInfo` hook. Since the seat is registered, a null render is a blank
  chip — the platform's captured-title fallback only applies when no renderer
  is registered. The seat now always renders.
- `GitTitle` fell back to the tab record's `title`, which is empty in a record
  that carries none. It now falls back to `type.label`, read fresh through the
  locale service, so the chip also follows a language change instead of the
  language of open time. An empty branch string counts as no branch, and the
  change count still speaks when there is no branch name to show.

Tests pin each branch: no store, a branch, a detached HEAD, and a branchless
change count; the `git` mount marker now asserts the chip title has visible
text in the real shell.

## New tab does not close the tab

The strip's add control is the docking kit's. It asks for
`openTab('guide', { paneId, revealIfOpened: false })`: a **Start** page opens
in the same pane and takes focus, and the Source control tab stays exactly
where it was. The panel body is unmounted while another tab is focused
("docked bodies need an expanded sidebar and an active tab"), which is what
reads as the tab having closed.

Verified with a temporary Playwright probe against a real dev runtime
(`dsh-next-dev` scratch home, git plugin only): four add / return / close-guide
cycles, four collapse and expand cycles, and a page reload. Every state kept
the `Source control` chip with non-empty text, and clicking it brought the
panel back. No plugin seam can change the add control; the behaviour is the
product's, not this plugin's.
