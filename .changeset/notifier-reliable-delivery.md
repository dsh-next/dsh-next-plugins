---
"@dsh-next/dsh-next-notifier": patch
---

Fixed notification delivery across multiple tabs so alerts prefer the focused page and sounds wait for a visible toast or browser display acknowledgement. Pending alerts can wait briefly for a foreground page when browser permission is unavailable.

- Distinguish successful, failed, blocked, and token-limited turns; keep cancelled turns quiet and avoid duplicate goal or unintended subagent alerts.
- Notify only for pending human approvals and questions, withdrawing stale requests when they settle.
- Make volume changes and sound previews reliable, surface settings errors, and fix keyboard dismissal of toasts.
- Reject malformed notification requests safely and clean up notifications, timers, and private sound files when the plugin stops.
