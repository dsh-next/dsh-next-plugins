---
"@dsh-next/dsh-next-notifier": patch
---

Fixed multi-tab notification ownership and wait for a visible toast or browser acknowledgement before authorizing sound. Pending alerts can wait briefly for a foreground page when background notification permission is unavailable.

- Distinguish failed, blocked, and token-limited turns, suppress cancelled or duplicate goal/subagent alerts, and withdraw approval or question alerts once resolved.
- Reject malformed requests and clean up pending notifications and timers when the plugin stops.
