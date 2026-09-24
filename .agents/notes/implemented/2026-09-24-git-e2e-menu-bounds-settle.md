# The git e2e reads the nested menu's settled bounds

- date: 2026-09-24
- status: implemented
- scope: tests/e2e/git.e2e.ts

## Symptom

The `git` Playwright lane failed on the nested-menu assertion:

```
expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
Expected: <= 1440
Received:    1597.671875
```

The same value came back on every run, which read as a layout regression rather
than a race.

## Root cause

The assertion read `boundingBox()` in the same tick the nested panel became
visible. The panel is positioned one frame later, so that first read catches it
at the trigger's left edge — `x 1434`, right edge `1597.67` — before the
positioner flips it to the left. Temporary instrumentation under Chromium 153
(playwright 1.63) printed both boxes:

```
[DEBUG-a4f2] first {"x":1434,...} settled {"x":1123.33,...} viewport {"width":1440,...}
```

The settled right edge is `1287`, inside the viewport, and the post-failure
screenshot shows the panel correctly flipped. Playwright 1.62's Chromium
happened to settle before the read, which is why the race stayed hidden for as
long as it did. The menu was never misplaced — the assertion raced it.

## Fix

[git.e2e.ts](/Users/rokgrabnar/Projects/dsh-next-plugins/tests/e2e/git.e2e.ts)
now polls the same condition the command-sample loop further down the file
already polls (`expect.poll`, 5s), so it asserts the settled box instead of one
arbitrary frame.

## Verification

- `node scripts/workflow.mjs e2e git` passes twice under playwright 1.63 /
  Chromium 153 and once under the previous playwright 1.62.1.
- The `[DEBUG-a4f2]` instrumentation was removed; `grep -rn DEBUG-a4f2 tests/`
  is empty.
- The full mount smoke keeps the `git` lane green (24.8s) alongside the other
  suites.
