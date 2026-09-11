/**
 * English dictionary — the key source for the `skills` locale namespace.
 *
 * English is this repo's language and the platform's fallback locale, so the
 * key set is defined here; `zh.ts` mirrors it (a missing or extra zh key is a
 * compile error via `Record<MessageKey, string>`, and the platform's typed
 * `register` checks both sides against the namespace's key union again).
 * Values may carry `{name}` placeholders — the platform's `t(key, params)`
 * substitutes them.
 *
 * Keys follow the Claude Plugins page's conventions (`tab.*`, `search.*`,
 * `provider.*`, `filter.*`, `card.*`, `sync.*`, `modal.*`,
 * `detail.*`) so the two settings pages stay grep-compatible; values adopt
 * the cc-plugins wording wherever the two surfaces share a concept.
 */

/** Dictionary namespace this panel owns (also the slot label's namespace). */
export const NS = 'skills'

export const en = {
  'nav': 'Skills',

  // Page scaffold (the shell's settings-section pattern: title, intro, tab
  // strip aria-label), mirroring the cc-plugins page's key set.
  'title': 'Skills',
  'intro': 'Install and manage skills globally.',
  'tabs': 'Skill views',

  'tab.skills': 'Skills',
  'tab.providers': 'Providers',

  'search.placeholder': 'Search skills…',
  'provider.aria': 'Provider',
  'provider.all': 'All providers',
  'filter.installedOnly': 'Installed only',

  'empty.noProviders': 'No providers yet. Add a GitHub repository in the Providers tab to browse its skills.',
  'empty.noMatch': 'No skills match the current filters.',

  'card.noDescription': 'no description',
  'card.detailsTitle': 'details for {name}',
  'card.update': 'Update',
  'card.providers': 'Providers ({count})',
  'card.providersTitle': 'Switch where this skill comes from',
  'card.delete': 'Delete',
  'card.install': 'Install',
  'card.replace': 'Replace',

  'source.userDsh': 'user .dsh',
  'source.userAgents': 'user .agents',
  'source.custom': 'custom',

  'sync.never': 'never',
  'sync.unknown': 'unknown',
  'sync.justNow': 'just now',
  'sync.minutesAgo': '{count}m ago',
  'sync.hoursAgo': '{count}h ago',
  'sync.daysAgo': '{count}d ago',

  'modal.cancel': 'Cancel',
  'modal.confirmDelete': 'Delete',

  'delete.aria': 'Delete skill "{name}"',
  'delete.title': 'Delete {name}?',
  'delete.hint': 'This moves the copy below into the trash of its root (recoverable).',

  'sources.aria': 'Sources for skill "{name}"',
  'sources.title': 'Sources for {name}',
  'sources.hint': 'Pick where this skill comes from. Switching to a provider overwrites the copy in place.',
  'sources.local': 'Local (hand-managed)',
  'sources.localHint': 'Keep the files as they are; no provider updates.',
  'sources.current': 'Current',
  'sources.matches': 'Matches your copy',
  'sources.differs': 'Differs from your copy',
  'sources.detach': 'Detach',
  'sources.confirmTitle': 'Replace {name}?',
  // States the real updateSkill semantics: in-place overwrite, extras removed
  // permanently (no trash).
  'sources.confirmBody': 'Your copy is overwritten with the {provider} version. Files that are not part of the provider copy are removed permanently (not moved to trash).',
  'sources.confirmReplace': 'Replace',

  'providers.placeholder': 'owner/repo or GitHub URL…',
  'providers.add': 'Add provider',
  'providers.refreshAll': 'Refresh all',
  'providers.refreshing': 'Refreshing…',
  'providers.refreshProgress': 'Refreshing {done}/{total}…',
  'providers.refreshFailed': 'Refresh failed for {count} provider(s): {items}',
  'providers.remove': 'Remove',
  'providers.skillCount.one': '{count} skill',
  'providers.skillCount.many': '{count} skills',
  'providers.lastSynced': 'last synced {age}',
  'providers.removeAria': 'Remove provider "{name}"',
  'providers.removeTitle': 'Remove {name}?',
  'providers.removeHint': 'Installed skills are kept. The provider and its cached skill catalog are removed.',
  'providers.hint': 'Providers are GitHub repositories with skill directories (a SKILL.md); syncing caches their files locally so installs work offline.',

  'detail.aria': 'Skill details "{name}"',
  'detail.modelInvocable': 'model invocable',
  'detail.modelBlocked': 'model blocked',
  'detail.userInvocable': 'user invocable',
  'detail.userBlocked': 'not user invocable',
  'detail.whenToUse': 'When to use: {text}',
  'detail.close': 'Close',

  'openFolder.label': 'Open skill folder',
  'openFolder.title': 'Open skill folder in {app}',
  'openFolder.menu': 'Choose an app to open the skill folder',
  'openFolder.error': 'Failed to open skill folder. Try again.',
  'openFolder.app.finder': 'Finder',
  'openFolder.app.explorer': 'File Explorer',
  'openFolder.app.filemanager': 'Files',
  'openFolder.app.cursor': 'Cursor',
  'openFolder.app.vscode': 'VS Code',
  'openFolder.app.vscodeinsiders': 'VS Code Insiders',
  'openFolder.app.windsurf': 'Windsurf',
  'openFolder.app.zed': 'Zed',
  'openFolder.app.sublimetext': 'Sublime Text',
  'openFolder.app.xcode': 'Xcode',
  'openFolder.app.androidstudio': 'Android Studio',
  'openFolder.app.intellij': 'IntelliJ IDEA',
  'openFolder.app.pycharm': 'PyCharm',
  'openFolder.app.webstorm': 'WebStorm',
  'openFolder.app.phpstorm': 'PhpStorm',
  'openFolder.app.goland': 'GoLand',
  'openFolder.app.rider': 'Rider',
  'openFolder.app.rustrover': 'RustRover',
  'openFolder.app.fork': 'Fork',
  'openFolder.app.sourcetree': 'Sourcetree',
  'openFolder.app.github': 'GitHub Desktop',
  'openFolder.app.tower': 'Tower',
  'openFolder.app.gitkraken': 'GitKraken',
  'openFolder.app.smartgit': 'SmartGit',
  'openFolder.app.sublimemerge': 'Sublime Merge',
  'openFolder.app.ghostty': 'Ghostty',
  'openFolder.app.warp': 'Warp',
  'openFolder.app.iterm': 'iTerm2',
  'openFolder.app.kitty': 'kitty',
  'openFolder.app.terminal': 'Terminal',
  'openFolder.app.windowsterminal': 'Windows Terminal',
  'openFolder.app.gitbash': 'Git Bash',
  'openFolder.app.gnometerminal': 'GNOME Terminal',
  'openFolder.app.konsole': 'Konsole',

  'list.showMore': 'Show more skills',

  'status.working': 'Working…',
  'status.done': 'Done',
  'status.requestFailed': 'Request failed',
  'status.refreshFailed': 'Refresh failed',
  'rpc.failed': 'Skills request "{method}" failed (HTTP {status})',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
