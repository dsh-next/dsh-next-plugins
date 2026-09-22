# Adopt the 0.1.7-alpha.1 shell icon set

- date: 2026-09-22
- status: implemented
- scope: packages/dsh-next-git, dsh-next-notifier, dsh-next-oauth-providers, dsh-next-skills, scripts/workflow-config.json

DeepSeek Harness `0.1.7-alpha.1` renamed every size-suffixed icon in
`@deepseek-ai/dsh-client-ui-primitives` to a weight-suffixed one
(`IconPlusOutline16` becomes `IconPlusOutlineRegular`, the 14px artwork merges
into the same 16-grid drawing with a `size` prop). The old names are absent from
the shell's module table, so any slot entry that rendered one crashed with React
error 130: the oauth-providers footer and the git right-pane tab were dead, and
the notifier and skills chevrons were latent behind conditionals.

What changed:

- The four packages that import primitives pin `0.1.7-alpha.1`, use the new
  names, and declare DSH `>=0.1.7-alpha.1`; `scripts/workflow-config.json`
  moves the tested target with them and the README minimums follow.
- `@deepseek-ai/dsh-client-ui-primitives` ships its runtime dependencies as
  devDependencies from this version on, so the client tests also devDepend on
  `@deepseek-ai/dsh-util-workspace-path` to resolve the new `PathLabel` import.
  The other bare imports resolve from pnpm's hoisted store.
- The skills tooltip test restores keyboard modality before focusing: the
  shell tooltip now suppresses a focus bubble after any pointer interaction,
  and an earlier test in the same file dispatches `pointerdown`.

Verified with `pnpm check` (typecheck, unit and script tests, build, runtime
dependency check, docs, i18n) and `pnpm run test:e2e smoke`, where every client
bundle mounts. The older `Icon*16`/`Icon*14` imports are gone from the whole
repository.

This is not enough to make the plugins work on `0.1.7-alpha.1`: the host halves
of notifier, oauth-providers, and skills call the removed settings-namespace API
and never register their RPC routes. See
[the port note](../proposed/2026-09-22-port-plugins-to-dsh-017-config-model.md).
