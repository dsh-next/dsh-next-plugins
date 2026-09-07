# checkpoints rewind creates a live Agent

- date: 2026-09-07
- status: implemented
- scope: packages/dsh-next-checkpoints

Host `sessions.fork` published a live Session with no Agent. After rewind
the client opened that id; the next prompt went through session-controller
`resolveAgent`, found no live Agent, and tried `persistence.prepare`, which
rejects `cannot prepare session while it is live`.

Rewind now forks through `ctx.agents.create` with the checkpoint event
prefix (empty at Session start), parent cwd/model/preset, the same way
session-controller's UI Fork does. The child is a live Agent, so prompt
and resume work. Workspace attach is unchanged.
