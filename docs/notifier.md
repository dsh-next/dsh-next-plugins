# Notifications: behavior and troubleshooting

The [plugin README](<../packages/dsh-next-notifier/README.md>) covers installation,
permissions, and a first alert.

## Choose what interrupts you

| Event | Behavior |
| --- | --- |
| Agent finishes, errors, becomes blocked, or reaches a response limit | Separate event labels explain the outcome. Terminal alerts wait for two seconds of idle time; a resumed or disposed agent cancels its pending alert. |
| Agent is cancelled or interrupted | No terminal alert. |
| `Approval needed` or `Question asked` | An alert is pending only while a human response is needed. Requests resolved within 200 ms stay quiet; resolving or aborting withdraws the pending alert. |
| `Subagent finished` | Off by default. |
| Goal finishes or becomes blocked | One goal alert instead of a duplicate turn-finished alert. |

`Only notify when the goal completes` is on by default. Active, armed goals
suppress ordinary finish alerts, not errors. `Mute while viewing the session`
is also on by default. A session hidden behind the Plugins panel does not count
as actively viewed.

## Save or reset preferences

Open `Plugins` → `Notifications`. Controls appear directly on the installed
plugin page, above `Components`, not on a separate component settings page.

- Changes save automatically; errors appear inline. There is no Save button.
- Rapid volume changes are combined after a short pause.
- `Restore inherited settings` resets immediately.
- Read-only connections cannot change saved preferences.
- Desktop and web use the same implementation. Preferences persist through
  Harness's current configuration owner.

## Understand delivery across windows

A focused, visible client has first priority and uses a Harness in-page toast;
it does not need system-notification permission. Otherwise, a background client
with permission can display a system notification. The host coordinates open
windows and tabs so only one client holds an alert's delivery lease at a time.

An in-page toast has `Open session` and `Dismiss` actions, including keyboard
support. The newest toast replaces the previous one and remains for about
12 seconds. Clicking a system notification returns to its session.

Without background notification permission, an alert can wait up to 120 seconds
for a foreground client. There is no offline inbox: closing all clients discards
pending alerts. Keeping only the remote Harness host running is not enough.

## Set up sound on each device

Sounds play through Web Audio on the client showing the alert, not through a
sound player on the host. This also applies when the host is remote. Click
`Preview` after opening a client if its browser requires a gesture to allow audio.

Each event category has `Play sound` and a `Sound` selector. `Volume` ranges
from 0 to 100. There are 17 synthesized sounds; existing saved choices are kept.
Default sounds are `Chime` for completion, `Ping` for approval, and `Chirp` for
questions. `Preview` plays a sound without changing settings.

Automatic sound starts only after the toast is visibly rendered or the system
notification API reports it shown. System notifications request silent playback
to avoid a second system sound. Audio errors do not block visual alerts or cause
playback on the host machine.

## If alerts are missing

1. Check `Enable notifications` and the event's own switch.
2. Check whether viewing the session or an active goal is deliberately muting it.
3. Use `Show` beside `Test in-page toast` to test foreground delivery.
4. Use `Enable` and `Test` beside `System notifications` to test permission and
   background delivery. Check OS permissions and Do Not Disturb too.
5. For missing sound, check `Play sound`, volume, device mute, and `Preview`.

A successful browser API call does not prove an OS banner was visible. System
policy, browser autoplay rules, and background-tab throttling can suppress or
delay presentation. The plugin cannot notify after all renderers close.

For development and validation, see [Contributing](<../CONTRIBUTING.md>).
