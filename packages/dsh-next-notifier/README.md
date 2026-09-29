# Notifications for DeepSeek Harness

English | [中文](README.zh.md)

Get an alert when an agent finishes, encounters a problem, or needs your response—on desktop or in your browser.

## Install

Requires DeepSeek Harness `0.1.7-rc.1` or newer.

```sh
dsh plugin --profile <name> add @dsh-next/dsh-next-notifier
```

Replace `<name>` with your DSH profile, for example `web`, and open Harness using that profile.

## Quick start

1. Open `Plugins` → `Notifications` in the installed list.
2. Leave `Enable notifications` on and choose the events you want. Settings save automatically.
3. Click a sound's `Preview` to enable audio on this device. Use `Show` beside `Test in-page toast` to try an on-screen alert.
4. For background alerts, click `Enable` beside `System notifications`, allow notifications, then click `Test`.
5. Start a task and switch to another session or app. When an alert appears, use `Open session` or click the system notification to return.

## What you can do

- **Know when you are needed:** receive completion, error, approval, and question alerts.
- **Choose your sounds:** set a sound for each event and adjust the volume.
- **Use multiple windows:** open clients coordinate delivery to avoid showing every alert in every window.

![Notification settings with event switches, sounds, and permission controls](<media/settings.webp>)

## Good to know

- `Mute while viewing the session` is on by default. So is `Only notify when the goal completes`; ordinary finishes during an active goal stay quiet. `Subagent finished` is off.
- Keep a desktop window or browser page open. There is no offline inbox after all clients close.
- Sounds play on your device, not a remote Harness server. If silent, try `Preview` and check volume, mute, and `Play sound`.
- Missing system alerts? Check notification permission and your operating system's Do Not Disturb settings. The plugin cannot guarantee that a banner is shown.

[Alert behavior and troubleshooting](<https://github.com/dsh-next/dsh-next-plugins/blob/main/docs/notifier.md>) · [Get help](<https://github.com/dsh-next/dsh-next-plugins/issues>) · [Contributing](<https://github.com/dsh-next/dsh-next-plugins/blob/main/CONTRIBUTING.md>)
