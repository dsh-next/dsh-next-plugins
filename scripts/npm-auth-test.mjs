/** Explicit npm identity and packed-package dry run; never reads repository secrets. */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { planPackages, packPackages, repositoryRoot } from './workflow-pack.mjs'
import { runCommand, withoutModelCredentials } from './workflow-runtime.mjs'

export async function checkNpmAuth(slug = 'notifier', { env = process.env, run = runCommand, plan = planPackages, pack = packPackages, signal } = {}) {
  const selected = await plan([slug])
  const safeEnv = withoutModelCredentials(env)
  // npm uses its normal user configuration, including NPM_TOKEN interpolation.
  const identity = await run('npm', ['whoami'], { cwd: repositoryRoot, env: safeEnv, signal })
  const artifacts = await pack(selected, { env: safeEnv, run, signal })
  const requested = artifacts.find(artifact => artifact.name === selected.requested[0].name)
  if (!requested) throw new Error('Requested package was not packed')
  const result = await run('npm', ['publish', requested.path, '--dry-run', '--ignore-scripts', '--access', 'public'], { cwd: repositoryRoot, env: safeEnv, signal })
  return { identity: identity.stdout.trim(), package: requested.name, artifact: requested.path, dryRun: true, output: result.stdout, note: 'Identity and package dry run do not prove publish authorization.' }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'))
  if (args.length > 1 || (args[0]?.startsWith('-') && args[0] !== '--help')) {
    console.error('Usage: npm-auth-test.mjs [plugin-slug]'); process.exitCode = 2
  } else if (args[0] === '--help') {
    console.log('Usage: npm-auth-test.mjs [plugin-slug]\nUses normal npm user configuration; confirms identity and performs a dry run, never publishes.')
  } else {
    const controller = new AbortController()
    const abort = () => controller.abort()
    process.once('SIGINT', abort); process.once('SIGTERM', abort)
    checkNpmAuth(args[0], { signal: controller.signal }).then(result => console.log(JSON.stringify(result, null, 2)), error => {
      console.error(error.message); process.exitCode = controller.signal.aborted ? 130 : 1
    }).finally(() => { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort) })
  }
}
