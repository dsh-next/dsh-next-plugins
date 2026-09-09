import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkNpmAuth } from './npm-auth-test.mjs'

test('npm auth uses normal user configuration, strips model keys, and dry-runs only packed requested artifact', async () => {
  const calls = []
  const controller = new AbortController()
  const result = await checkNpmAuth('example', {
    env: { NPM_TOKEN: 'synthetic-registry-token', DEEPSEEK_API_KEY: 'synthetic-model-key' }, signal: controller.signal,
    plan: async selectors => { assert.deepEqual(selectors, ['example']); return { requested: [{ name: 'example' }] } },
    pack: async (_plan, options) => {
      assert.equal(options.env.DEEPSEEK_API_KEY, undefined)
      assert.equal(options.env.NPM_TOKEN, 'synthetic-registry-token')
      assert.equal(options.signal, controller.signal)
      return [{ name: 'dependency', path: '/tmp/dependency.tgz' }, { name: 'example', path: '/tmp/path with spaces.tgz' }]
    },
    run: async (command, args, options) => { calls.push({ command, args, options }); return { stdout: args[0] === 'whoami' ? 'example-user\n' : 'dry run', code: 0 } },
  })
  assert.equal(result.identity, 'example-user')
  assert.equal(result.dryRun, true)
  assert.deepEqual(calls[1].args, ['publish', '/tmp/path with spaces.tgz', '--dry-run', '--ignore-scripts', '--access', 'public'])
  for (const call of calls) {
    assert.equal(call.options.env.DEEPSEEK_API_KEY, undefined)
    assert.equal(call.options.signal, controller.signal)
  }
  assert.equal(JSON.stringify(result).includes('synthetic-registry-token'), false)
})

test('failed identity does not start packaging', async () => {
  let packed = false
  await assert.rejects(checkNpmAuth('x', {
    plan: async () => ({ requested: [{ name: 'x' }] }),
    run: async () => { throw new Error('Identity unavailable') },
    pack: async () => { packed = true },
  }), /Identity unavailable/)
  assert.equal(packed, false)
})
