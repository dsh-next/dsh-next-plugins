# Checkpoints newest first

- date: 2026-09-09
- status: implemented
- scope: packages/dsh-next-checkpoints

The checkpoint rail now sorts a copy of the RPC rows by descending timestamp,
then descending sequence for equal timestamps. Default selection uses the first
row; refresh preserves a valid explicit selection. Host storage and rewind
chronology are unchanged. The bilingual README pair and patch changeset record
the new ordering.

Regression coverage exercises shuffled input, equal timestamps, newest default
selection, a newly appended checkpoint, selection retention, and input immutability.
All 136 checkpoint tests passed, and the final browser suite passed after review.
Repository typecheck, tests, build, docs, and i18n checks passed using
`--config.verify-deps-before-run=false` to avoid pnpm attempting an unsolicited
non-interactive dependency reinstall. No dependency files were changed.

Earlier full validation exposed E2E fixture interference and a deleted-source
enumeration error, documented in the testing-workflow review. The unified
workflow now resolves both: all eight keyless E2E tests pass in fresh suite
runtimes, including the six detailed checkpoint cases, and the explicit live
checkpoint test passes after correcting stale modal-copy and empty-child UI
expectations. No checkpoint production behavior was changed for those tests.

The real API key was available through interactive zsh, not the inherited
non-interactive tool environment; it was never missing globally. Live validation
used an explicit interactive-shell invocation. The runner itself never sources
shell startup and supports inherited env or an approved user env file.

Evidence: `artifacts/testing/run-y52lNt/summary.json` (keyless),
`artifacts/testing/run-aoObj4/summary.json` (live), and the
`checkpoints-newest-first.png` screenshot in the keyless run. The running GUI
was not reinstalled or restarted; test runtimes were isolated and stopped.
