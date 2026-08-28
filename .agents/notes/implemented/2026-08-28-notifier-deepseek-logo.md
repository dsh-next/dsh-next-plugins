# Swap notifier notification icon to the official DeepSeek logo

- date: 2026-08-28
- status: implemented
- scope: packages/dsh-next-notifier

Replaced the hand-drawn 32x32 whale mark with the official DeepSeek logo as the
web Notification icon.

- Downloaded the DeepSeek brand mark from zonalogo.com (the source URL), took
  the 128px variant, and flood-filled the solid light-gray background to
  transparent so it composites cleanly on both light and dark OS notification
  surfaces.
- Embedded the resulting 128x128 RGBA PNG as an inline data URI, consistent
  with the existing pattern: no binary asset shipped, no runtime fetch.
- Renamed the module from `src/client/whale-icon.ts` (`WHALE_ICON`) to
  `src/client/deepseek-icon.ts` (`DEEPSEEK_ICON`), updated the
  `drainer.ts` import/usage, and updated the settings-card hint text
  ("Whale icon" -> "DeepSeek icon").
- Renamed/updated the drainer test description and its match assertion (still
  `data:image/png;base64,`).

Verified: `pnpm typecheck`, `pnpm test` (66), `pnpm build` (icon inlined into
`lib/client.js`, whale refs gone), `bash scripts/e2e-mount.sh` (1 passed). The
served bundle decodes to the exact 128x128 transparent PNG (SHA-256 matches
the source).
