# @dsh-next/dsh-next-notifier

## 0.3.0

### Minor Changes

- **Breaking:** Requires DeepSeek Harness 0.1.7-rc.1 or newer. Notification settings now live directly on the installed Notifications page and save automatically. Configuration uses the plugin's profile entry; legacy preferences are imported into the active profile. Sounds play on the receiving desktop or browser device instead of the host, so keep a client open and use Preview if that device requires an audio gesture.
  
  Use Harness-native controls and toasts, localized alerts, current-session navigation, and coordinated desktop/web delivery. Existing event preferences and sound choices are retained; cancelled or muted alerts cannot authorize stale sound. Sound previews, volume changes, keyboard dismissal, and visible settings errors use the native interface.

### Patch Changes

- Show readable English and Chinese plugin names, concise descriptions, and distinct icons in the Harness plugin manager.
- Fixed multi-tab notification ownership and wait for a visible toast or browser acknowledgement before authorizing sound. Pending alerts can wait briefly for a foreground page when background notification permission is unavailable.
  
  - Distinguish failed, blocked, and token-limited turns, suppress cancelled or duplicate goal/subagent alerts, and withdraw approval or question alerts once resolved.
  - Reject malformed requests and clean up pending notifications and timers when the plugin stops.

## 0.2.0

### Minor Changes

- The notifier settings card uses the shell's disclosure chevron icon instead of
  a text glyph, aligns its controls with the harness field styling, and
  localizes transport error messages through the locale service.
- Alerts now arrive through the channel that fits where you are: an in-page
  toast at the top of the window while you are looking at the page (click opens
  the session, close dismisses, auto-dismiss after 12 seconds, no browser
  permission needed), and the usual web notification with the DeepSeek icon when
  the window is minimized or backgrounded. The settings card gains a Test
  in-page toast button, keeps one toast card per session, and is now titled
  Notifier in Settings -> Plugins. Fixed: "mute while viewing the session" now
  resolves the current session on the installed shell, so alerts for the session
  you are looking at stay quiet as configured.

## 0.1.1

### Patch Changes

- Initial release of the notifier plugin.
