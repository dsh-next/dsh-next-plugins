# checkpoints detailed Playwright suite

- date: 2026-09-06
- status: implemented
- scope: tests/e2e/checkpoints.e2e.ts

Expanded the dedicated checkpoints lane into six real-mount Playwright
tests: inspect/rewind golden path, binary + multi-file + CRLF, `/rewind`
non-restore and Cancel, confirm-modal facts, browser RPC envelopes
(list/diffs/preview/rewind/errors), and Deleted/Created plus file switching.
Helpers now include `startChangesSession` and a typed RPC client.
