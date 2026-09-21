# Notifier configuration on the Plugins page

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-notifier

Notifier configuration now registers through the current `plugins.item` slot.
The Plugins page owns the Notifier title and summary card, while the page view
renders the existing controls expanded without the retired nested disclosure
chrome. The browser bundle explicitly injects the plugin manager and raises its
DSH floor to `0.1.6-alpha.2`; the obsolete `settings.plugin.item` dependency was
removed.

The old registration waited forever because current DSH no longer declares
`settings.plugin.item`; navigating to Settings → Built-in plugins could therefore
never reveal Notifier. Browser lifecycle tests now pin summary/page rendering and
slot disposal, and the real Notifier suite opens the global Plugins page, exercises
the configuration, captures the new page-width screenshot, and verifies toast
keyboard dismissal.
