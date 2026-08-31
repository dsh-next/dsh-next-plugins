/**
 * Command translation: Claude commands/*.md into DSH slash-command names,
 * and $ARGUMENTS template expansion. Pure core coverage for
 * `core/commands.ts`.
 */
import { describe, expect, it } from 'vitest'
import { commandsFromFiles, dshCommandName, expandTemplate } from '../src/core/commands.ts'

describe('dshCommandName', () => {
  it('keeps names already valid in the DSH grammar', () => {
    expect(dshCommandName('team-tools', 'ship')).toBe('ship')
    expect(dshCommandName('team-tools', 'deploy-prod')).toBe('deploy-prod')
  })

  it('qualifies names with dots, case, or a bad start', () => {
    expect(dshCommandName('team-tools', 'Ship.It')).toBe('cc-team-tools-ship-it')
    // A digit-leading Claude name becomes valid once qualified.
    expect(dshCommandName('team-tools', '9deploy')).toBe('cc-team-tools-9deploy')
  })
})

describe('commandsFromFiles', () => {
  it('extracts top-level commands with frontmatter descriptions', () => {
    const { commands, notes } = commandsFromFiles({
      'commands/ship.md': '---\ndescription: Ship the app\n---\nShip $ARGUMENTS now.',
      'commands/deploy.md': 'Deploy everything.',
      'commands/ignored.txt': 'not a command',
    }, 'team-tools')
    expect(commands).toEqual([
      { name: 'deploy', claudeName: 'deploy', description: 'Claude command deploy', hint: '', template: 'Deploy everything.' },
      { name: 'ship', claudeName: 'ship', description: 'Ship the app', hint: '', template: 'Ship $ARGUMENTS now.' },
    ])
    expect(notes).toEqual([])
  })

  it('passes argument-hint frontmatter through as the command hint', () => {
    const { commands } = commandsFromFiles({
      'commands/issue.md': '---\ndescription: Work an issue\nargument-hint: [issue-number]\n---\nFix $ARGUMENTS.',
      'commands/quoted.md': '---\nargument-hint: "[filename] [format]"\n---\nBody.',
    }, 'team-tools')
    expect(commands.find((c) => c.name === 'issue')?.hint).toBe('[issue-number]')
    expect(commands.find((c) => c.name === 'quoted')?.hint).toBe('[filename] [format]')
  })

  it('skips nested commands with a note and derives qualified names for invalid ones', () => {
    const { commands, notes } = commandsFromFiles({
      'commands/group/deep.md': 'x',
      'commands/Review.md': 'y',
    }, 'team-tools')
    expect(commands.map((c) => c.name)).toEqual(['cc-team-tools-review'])
    expect(notes.join(' ')).toContain('nested command "group/deep.md" skipped')
  })

  it('returns nothing for an empty file set', () => {
    expect(commandsFromFiles({}, 'x')).toEqual({ commands: [], notes: [] })
  })
})

describe('expandTemplate', () => {
  it('replaces every $ARGUMENTS token with the trimmed input', () => {
    expect(expandTemplate('Run $ARGUMENTS then $ARGUMENTS', '  --fast  ')).toBe('Run --fast then --fast')
  })

  it('leaves templates without the token unchanged', () => {
    expect(expandTemplate('plain body', 'input')).toBe('plain body')
  })
})
