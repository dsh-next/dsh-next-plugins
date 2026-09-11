# @dsh-next/dsh-next-notifier

## 0.2.1

### Patch Changes

- Fixed notification delivery across multiple tabs so alerts prefer the focused page and sounds wait for a visible toast or browser display acknowledgement. Pending alerts can wait briefly for a foreground page when browser permission is unavailable.
  
  - Distinguish successful, failed, blocked, and token-limited turns; keep cancelled turns quiet and avoid duplicate goal or unintended subagent alerts.
  - Notify only for pending human approvals and questions, withdrawing stale requests when they settle.
  - Make volume changes and sound previews reliable, surface settings errors, and fix keyboard dismissal of toasts.
  - Reject malformed notification requests safely and clean up notifications, timers, and private sound files when the plugin stops.

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
