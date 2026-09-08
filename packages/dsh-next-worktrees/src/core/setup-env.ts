/**
 * Environment for `.worktrees.json` setup subprocesses.
 *
 * The DSH host often inherits `npm_*` / `PNPM_*` / `INIT_CWD` from how it
 * was launched. Nested worktrees live inside the harbor checkout, so
 * pnpm would otherwise walk up into that workspace and lstat the new
 * folder as if it were a missing package (`ENOENT`). Pin workspace dir
 * and cwd to the worktree so install runs there.
 */

/**
 * Copy the parent env, drop npm/pnpm workspace inheritance, and pin
 * cwd-related vars to the worktree so install runs there.
 *
 * @param parent - `process.env` from the host.
 * @param extra - plugin-owned vars (`ROOT_WORKTREE_PATH`, …).
 * @param cwd - the worktree checkout.
 * @returns env for `execFile`.
 */
export function setupChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  extra: Readonly<Record<string, string>>,
  cwd: string,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(parent)) {
    if (value === undefined) continue
    const lower = key.toLowerCase()
    if (lower.startsWith('npm_') || lower.startsWith('pnpm_')) continue
    if (key === 'NODE_PATH' || key === 'INIT_CWD' || key === 'PWD') continue
    env[key] = value
  }
  Object.assign(env, extra)
  env.INIT_CWD = cwd
  env.PWD = cwd
  // pnpm reads this instead of walking up to a parent workspace.
  env.NPM_CONFIG_WORKSPACE_DIR = cwd
  env.npm_config_workspace_dir = cwd
  env.npm_config_confirm_modules_purge = 'false'
  env.NPM_CONFIG_CONFIRM_MODULES_PURGE = 'false'
  if (env.CI === undefined) env.CI = 'true'
  return env
}
