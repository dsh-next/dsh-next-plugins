/**
 * English dictionary — the key source for the `checkpoints` locale namespace.
 */

/** Locale namespace this plugin owns (also the slot label's namespace). */
export const NS = 'checkpoints'

export const en = {
  'view.changes': 'Checkpoints',

  'empty.title': 'No checkpoints yet',
  'empty.body': 'A Session start checkpoint is saved when the session begins, and another at the end of each turn. Select one to inspect the files changed up to that moment.',

  'rail.label': 'Checkpoints',
  'row.turn': 'turn {turn}',
  'row.sessionStart': 'Session start',
  'row.rewind': 'Rewind',
  'row.rewindAria': 'Rewind to turn {turn}',
  'row.rewindAriaStart': 'Rewind to session start',
  'row.iconAria': 'Turn {turn}',
  'row.iconAriaStart': 'Session start',
  'row.inProgress': 'In progress',
  'row.inProgressAria': 'Turn {turn} in progress',
  'rail.resize': 'Resize checkpoints',

  'files.label': 'Files',
  'files.empty': 'No file changes up to this checkpoint.',
  'files.closePreview': 'Close',
  'files.statAria': '{added} added, {removed} removed',
  'files.added': '+{count}',
  'files.removed': '-{count}',

  'file.binary': 'Binary file — not shown as a diff.',
  'file.tooLarge': 'Too large to diff.',
  'file.invalidUtf8': 'Invalid UTF-8 — not shown as a diff.',
  'file.timeout': 'Diff timed out — body skipped.',
  'file.symlink': 'Symlink — not shown as a diff.',
  'file.directory': 'Directory — not shown as a diff.',
  'file.deleted': 'Deleted',
  'file.created': 'Created',
  'file.modified': 'Modified',

  'banner': 'Rewound to this checkpoint. Later messages are not sent to the model.',

  'modal.title': 'Please confirm',
  'modal.body': 'This restores files and opens a truncated chat at that moment. Later turns are dropped from the new session.',
  'modal.lost': 'Please note that any changes up to this selected checkpoint will be lost.',
  'modal.filesDelete': 'Files that will be deleted',
  'modal.turns': '{count} later turns will no longer be sent to the model.',
  'modal.dirty': 'Non-agent dirty paths that would be overwritten',
  'modal.headMoved': 'HEAD has moved since this checkpoint. Files will match the checkpoint; later commits stay. Reset git yourself if you want history to match.',
  'modal.headMovedDetail': 'Checkpoint {checkpoint} · current {current}',
  'modal.cancel': 'Cancel',
  'modal.rewind': 'Rewind',
  'modal.confirm': 'Restore this checkpoint',
  'modal.blocker.openTurn': 'A turn is still running. Wait until it ends, then rewind.',
  'modal.blocker.unrestorable': 'One or more paths cannot be restored (missing snapshot or unrestorable kind).',
  'modal.error': 'Rewind failed: {message}',

  'diff.copy': 'Copy',
  'diff.copied': 'Copied',
  'diff.collapseAria': 'Collapse diff',
  'diff.expandAria': 'Expand {count} more lines',
  'diff.collapse': 'Collapse',
  'diff.expandRest': 'Expand {count} more lines',
  'diff.files.one': '1 file',
  'diff.files.other': '{count} files',
}

export type MessageKey = keyof typeof en
