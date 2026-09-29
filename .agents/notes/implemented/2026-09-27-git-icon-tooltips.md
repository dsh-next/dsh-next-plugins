# One tooltip pattern for Git icons

- date: 2026-09-27
- status: implemented
- scope: packages/dsh-next-git

The Source control controls previously mixed native `title` popups, copyable hover cards, unstyled icons and the merge tooltip. All icon-only actions now use the platform tooltip with the merge action's top/end placement and a body portal. Localized accessible labels remain on their buttons. A focusable target explains disabled actions without invoking an enclosing row. Changes, Worktrees, History, the ref picker, change-file toolbar, repository menu and composer branch chip share the pattern. Component tests cover the icon inventory, keyboard/disabled states and click safety; the Git browser suite checks the actual tooltip and screenshots.
