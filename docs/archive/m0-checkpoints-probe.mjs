/**
 * Throwaway M0 probe for dsh-next-checkpoints (docs/ideas/dsh-next-checkpoints.md).
 *
 * 1. Two user turns, each represented as user + assistant surface messages.
 * 2. Append a surface replace shadowing turn 2.
 * 3. Assert deriveMessages() omits turn 2.
 * 5. Restore file bytes from a hand-built snapshot; leave git HEAD untouched.
 *
 * (4) Chat-tab observation is documented from the SDK contract, not this script:
 * Chat's human transcript is append-origin, so later bubbles stay; v1 banner.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

const DSH = '/Users/rokgrabnar/.local/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const { Session, SessionId } = await import(`${DSH}/dsh-session/lib/index.js`)
const { createUserMessage, createAssistantMessage } = await import(`${DSH}/dsh-llm/lib/index.js`)

function text(value) {
  return [{ type: 'text', text: value }]
}

function user(value) {
  return createUserMessage({
    content: text(value),
    source: { kind: 'user' },
  })
}

function assistant(value) {
  return createAssistantMessage({
    content: text(value),
    source: { provider: 'probe', model: 'probe' },
  })
}

function textsOf(messages) {
  return messages.map((message) => {
    const block = message.content.find((item) => item.type === 'text')
    return block && typeof block.text === 'string' ? block.text : ''
  })
}

const session = Session.create(SessionId('m0-checkpoints'))

const turn1User = session.append('user/message', user('turn 1: edit alpha.txt'), { surfaceOp: 'append' })
session.append('assistant/message', {
  turn: 1,
  step: 1,
  message: assistant('edited alpha.txt to v1'),
}, { surfaceOp: 'append' })

const turn2User = session.append('user/message', user('turn 2: edit alpha.txt again'), { surfaceOp: 'append' })
const turn2Asst = session.append('assistant/message', {
  turn: 2,
  step: 1,
  message: assistant('edited alpha.txt to v2'),
}, { surfaceOp: 'append' })

const before = textsOf(session.deriveMessages())
if (before.length !== 4) {
  throw new Error(`expected 4 derived messages before replace, got ${before.length}: ${JSON.stringify(before)}`)
}
if (!before[2].includes('turn 2') || !before[3].includes('v2')) {
  throw new Error(`turn 2 missing from derived history before replace: ${JSON.stringify(before)}`)
}

const rewind = createUserMessage({
  content: text('Rewound to turn 1. Later messages are not sent to the model.'),
  source: {
    kind: 'plugin',
    plugin: 'dsh-next-checkpoints',
    form: 'notice',
    summary: 'Rewound to turn 1',
  },
})

const replaceEvent = session.append('user/message', rewind, {
  surfaceOp: {
    op: 'replace',
    start: turn2User.seq,
    end: turn2Asst.seq,
  },
  sourceEventSeqs: [turn2User.seq, turn2Asst.seq],
})

const after = textsOf(session.deriveMessages())
const afterJoined = after.join('\n')
if (afterJoined.includes('turn 2') || afterJoined.includes('v2')) {
  throw new Error(`FAIL (3): deriveMessages still contains turn 2: ${JSON.stringify(after)}`)
}
if (!after.some((item) => item.includes('turn 1'))) {
  throw new Error(`FAIL (3): turn 1 disappeared: ${JSON.stringify(after)}`)
}
if (!after.some((item) => item.includes('Rewound to turn 1'))) {
  throw new Error(`FAIL (3): rewind replacement missing from surface: ${JSON.stringify(after)}`)
}

const logTypes = session.snapshotEvents().map((event) => event.type)
if (!logTypes.includes('user/message') || session.snapshotEvents().length < 5) {
  throw new Error('FAIL: append-only log did not keep the shadowed events')
}

console.log('PASS (3): deriveMessages omits turn 2 after surface replace')
console.log('  before:', before)
console.log('  after:', after)
console.log('  replace seq:', replaceEvent.seq, 'surface nodes:', [...session.surface.nodes])
console.log('  log length:', session.snapshotEvents().length, '(append-only preserved)')
console.log('NOTE (4): Chat human transcript is append-origin; later bubbles stay. v1 banner.')

const scratch = await mkdtemp(join(tmpdir(), 'dsh-next-checkpoints-m0-'))
try {
  execFileSync('git', ['init'], { cwd: scratch, stdio: 'ignore' })
  const file = join(scratch, 'alpha.txt')
  await writeFile(file, 'v0\n')
  execFileSync('git', ['add', 'alpha.txt'], { cwd: scratch, stdio: 'ignore' })
  execFileSync('git', ['-c', 'user.email=m0@example.com', '-c', 'user.name=m0', 'commit', '-m', 'v0'], {
    cwd: scratch,
    stdio: 'ignore',
  })
  const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).trim()
  await writeFile(file, 'v2\n')
  const snapshot = 'v1\n'
  await writeFile(file, snapshot)
  const disk = await readFile(file, 'utf8')
  const headAfter = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: scratch, encoding: 'utf8' }).trim()
  if (disk !== snapshot) throw new Error(`FAIL (5): disk is ${JSON.stringify(disk)}`)
  if (headAfter !== headBefore) throw new Error(`FAIL (5): HEAD moved ${headBefore} -> ${headAfter}`)
  console.log('PASS (5): file bytes restored; HEAD untouched', headAfter.slice(0, 7))
} finally {
  await rm(scratch, { recursive: true, force: true })
}

console.log('M0 PASS: in-place surface replace is plugin-legal; files restore independently of git.')
