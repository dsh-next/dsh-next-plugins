import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EventEmitter } from 'node:events'
import { bareId, crashPattern, assertMountHealthy, runGuardedMarker, requireCheckpointsPanel, requirePluginMarkers, watchBrowserErrors } from './e2e-guards.mjs'

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

test('browser guards observe secondary pages and detach only their own listeners on failure', async () => {
  const primary = new EventEmitter()
  const secondary = new EventEmitter()
  const later = new EventEmitter()
  const context = new EventEmitter()
  context.pages = () => [primary]
  const unrelated = () => {}
  primary.on('pageerror', unrelated)
  const errors = watchBrowserErrors(context)
  context.emit('page', primary)
  context.emit('page', secondary)
  assert.equal(primary.listenerCount('pageerror'), 2)
  secondary.emit('console', { type: () => 'warning', text: () => 'dsh-next warning' })
  secondary.emit('console', { type: () => 'error', text: () => 'unrelated error' })
  assert.deepEqual(errors.pluginConsoleErrors, [])
  await assert.rejects(runGuardedMarker(async () => {
    secondary.emit('pageerror', new Error('secondary failed'))
    secondary.emit('console', { type: () => 'error', text: () => '[dsh-next-skills] failed' })
  }, () => assertMountHealthy({ getByText: () => [] }, [], errors.pageErrors, errors.pluginConsoleErrors, expect)), assert.AssertionError)
  assert.deepEqual(errors.pageErrors, ['secondary failed'])
  assert.deepEqual(errors.pluginConsoleErrors, ['[dsh-next-skills] failed'])
  errors.dispose()
  errors.dispose()
  assert.equal(primary.listenerCount('pageerror'), 1)
  assert.equal(primary.listeners('pageerror')[0], unrelated)
  assert.equal(secondary.listenerCount('pageerror'), 0)
  assert.equal(secondary.listenerCount('console'), 0)
  assert.equal(context.listenerCount('page'), 0)
  context.emit('page', later)
  assert.equal(later.listenerCount('pageerror'), 0)
})

test('smoke requires explicit coverage for every selected browser plugin', () => {
  const skills = '@dsh-next/dsh-next-skills'
  const reset = '@dsh-next/dsh-next-reset'
  const markers = { 'dsh-next-skills': async () => {} }
  assert.doesNotThrow(() => requirePluginMarkers([skills, reset], markers, { 'dsh-next-reset': 'Listener only; separate behavior suite.' }))
  assert.throws(() => requirePluginMarkers([], markers), /No client plugins/)
  assert.throws(() => requirePluginMarkers([skills, reset], markers), /reset needs a mount marker/)
  assert.throws(() => requirePluginMarkers([reset], {}, { 'dsh-next-reset': ' ' }), /needs a mount marker/)
  assert.throws(() => requirePluginMarkers([skills], { 'dsh-next-skills': true }), /needs a mount marker/)
  assert.throws(() => requirePluginMarkers(['constructor'], {}, {}), /needs a mount marker/)
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
