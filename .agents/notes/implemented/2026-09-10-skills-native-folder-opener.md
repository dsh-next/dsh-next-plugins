# Skills: native folder opener in the detail header

- date: 2026-09-10
- status: implemented
- scope: packages/dsh-next-skills

## Decision

Add the native-style application split button beside the skill detail title.
Reuse DSH’s authenticated app-list, icon, and launch HTTP routes instead of
introducing app detection, OS launch commands, or host RPC in this plugin.
The native header action is not publicly exported and reads a session cwd;
our small browser action accepts the selected installed copy’s directory.

The control uses platform Menu/Tooltip primitives, the native 26px pill geometry,
and theme tokens. The title row is a Skills-specific CSS extension; shared
modal chrome is unchanged. App labels remain in the plugin locale dictionaries.
App choice is remembered separately for skill dialogs, avoiding two controllers
silently writing the native header’s private preference store.

Menus use the platform’s supported portal placement so long application lists
remain reachable in short windows. Keyboard opening enters the selected app;
dismissal/selection restores opener focus. Escape is consumed by the innermost
menu, then by the skill dialog, before legacy outer Settings handlers. Native
origin resolution, including the null-origin desktop carrier fallback, is shared
by all three route calls. No native source or shared modal chrome was changed.

Visibility and user instructions live in the
[README](../../../packages/dsh-next-skills/README.md#open-a-skills-folder).
No registered workspace is created or required. Uninstalled provider cache
copies are never offered as user folders. No app launches occur during automated
UI tests; the native launch request is intercepted and its payload asserted.

## Validation

- Static gates passed: typecheck, all 1,260 unit tests across the plugin family,
  build, README pairing/docs, and i18n. Native runtime imports passed against an
  isolated Git index representing pending file additions/deletions; the real
  staging area was not changed.
- New coverage includes 44 standalone opener tests and six detail-integration
  cases using real platform primitives, plus a mounted helper for keyboard entry,
  focus restoration, first/second Escape, remembered choice, launch failure/retry,
  hidden no-app/unavailable/catalog states, and all 34 apps in a short viewport.
- The final isolated non-live family mount passed all four tests, including the
  independent opener test, native catalog mutation freshness, and native app/icon
  screenshots in dark and light themes. One earlier attempt timed out in the
  unrelated Reset marker before reaching Skills; the fresh fake-key rerun passed.
- Native portal measurement initially made immediate keyboard focus ineffective.
  A cancellable animation frame now focuses after placement; tests cover retired
  callbacks on close, unmount, and folder switch. No sleeps were added to UI code.
- Screenshot: [skills-folder.webp](../../../packages/dsh-next-skills/media/skills-folder.webp)
  at its native 680px display width. Application launches are intercepted in the
  interaction test; visual evidence uses the real native app list and icons.

The updated local build is installed into the existing web profile after
validation; the running host is not restarted by the agent. Direct inspection of
the authenticated GUI is unavailable to a fresh browser without its login token;
the user must refresh/reload the profile to examine the installed UI.

## Rebase verification

Rebased onto main’s released Skills 0.3.0 and canonical DSH 0.1.5-rc.1
workflow. The SDK graph, newer plugin behavior, and browser mount guards are
preserved. Independent integration review approved the rebased changes.

`pnpm run ci` passed: 1,714 package tests, 186 repository-script tests, all
static/build/docs/i18n gates, and 11 keyless E2E tests (four smoke, six checkpoints,
one worktrees-sidebar), with no suite retries. Evidence is retained locally in
`artifacts/testing/run-vIENLi/summary.json`. The supplementary canonical-workspace
assertion also passed seven isolated filesystem cases and syntax validation.
This integration run did not reinstall the existing web profile or restart its host.
