import assert from 'node:assert/strict'
import { test } from 'node:test'
import { bareId, crashPattern, assertMountHealthy, runGuardedMarker, requireCheckpointsPanel } from './e2e-guards.mjs'

// Deterministic assertion/DOM port: exercise the same orchestration used by the
// real marker without launching a browser or making a missing locator succeed.
function expect(actual, message) {
  return {
    toHaveCount(count) { assert.equal(actual.length, count, message) },
    toEqual(expected) { assert.deepEqual(actual, expected, message) },
    toBeVisible() { assert.equal(actual.visible, true, actual.name + ' must be visible') },
  }
}
function fixture({ tabVisible = true, panelVisible = true } = {}) {
  const state = { prepared: false, clicked: false, texts: [], pageErrors: [], consoleErrors: [] }
  const tab = { name: 'Checkpoints tab', visible: tabVisible, async click() { state.clicked = true } }
  const panel = { name: 'Checkpoints panel', get visible() { return panelVisible && state.clicked } }
  const page = {
    getByRole(role) {
      assert.equal(role, 'tablist')
      return { getByRole(role, options) {
        assert.equal(role, 'tab')
        assert.equal(options.name, 'Checkpoints')
        assert.equal(state.prepared, true)
        return tab
      } }
    },
    getByTestId(id) { assert.equal(id, 'dsh-next-checkpoints'); return panel },
    getByText(pattern) { return state.texts.filter((text) => pattern.test(text)) },
  }
  const prepare = async () => { state.prepared = true }
  const healthy = () => assertMountHealthy(page, ['@dsh-next/dsh-next-checkpoints'], state.pageErrors, state.consoleErrors, expect)
  const marker = () => requireCheckpointsPanel(page, prepare, expect)
  return { state, healthy, marker }
}

test('bare scoped IDs match real crash prefixes, not doubled prefixes or regex lookalikes', () => {
  assert.equal(bareId('@dsh-next/dsh-next-checkpoints'), 'dsh-next-checkpoints')
  assert.equal(bareId('dsh-next-checkpoints'), 'dsh-next-checkpoints')
  for (const text of ['dsh-next-checkpoints: crashed', '[dsh-next-checkpoints] failed']) {
    assert.equal(crashPattern('@dsh-next/dsh-next-checkpoints').test(text), true)
  }
  assert.equal(crashPattern('dsh-next-a.b').test('dsh-next-aXb: failed'), false)
  assert.equal(crashPattern('dsh-next-a.b').test('dsh-next-a.b: failed'), true)
})

test('checkpoint marker prepares a session, clicks required tab, and requires panel', async () => {
  const f = fixture()
  await runGuardedMarker(f.marker, f.healthy)
  assert.equal(f.state.prepared, true)
  assert.equal(f.state.clicked, true)
})

for (const options of [{ tabVisible: false }, { panelVisible: false }]) {
  test('missing checkpoint UI fails: ' + JSON.stringify(options), async () => {
    const f = fixture(options)
    await assert.rejects(runGuardedMarker(f.marker, f.healthy), /must be visible/)
  })
}

for (const [field, error] of [
  ['texts', 'dsh-next-checkpoints: crashed'],
  ['texts', '[dsh-next-checkpoints] crashed'],
  ['pageErrors', 'late unhandled error'],
  ['consoleErrors', '[dsh-next-checkpoints] late error'],
]) {
  test('guard fails for errors emitted after marker interaction: ' + error, async () => {
    const f = fixture()
    await f.healthy()
    await assert.rejects(runGuardedMarker(async () => {
      await f.marker()
      await Promise.resolve()
      f.state[field].push(error)
    }, f.healthy), assert.AssertionError)
  })
}

test('a failed interaction still runs its health guard and preserves failure', async () => {
  let checked = false
  await assert.rejects(runGuardedMarker(async () => { throw new Error('interaction failed') }, async () => { checked = true }), /interaction failed/)
  assert.equal(checked, true)
})
