# Worktrees live-model e2e lane

- date: 2026-09-05
- status: implemented
- scope: tests/e2e, scripts/e2e-mount.sh

`DSH_E2E_LIVE=1` with a real `DEEPSEEK_API_KEY` waits for the bound session
to finish turns (Update is blocked while running) and for MERGE_HEAD to
clear after the conflict handoff — the test no longer writes the
resolution. Keyless `mise run e2e` is unchanged.
