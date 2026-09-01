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
 * English values are byte-identical to the strings this panel rendered
 * before localization, so English-language tests assert the same text.
 */

/** Dictionary namespace this panel owns (also the slot label's namespace). */
export const NS = 'skills'

export const en = {
  'section.title': 'Skills',

  'tab.installed': 'Installed',
  'tab.search': 'Search',
  'tab.providers': 'Providers',

  'search.placeholder': 'Search skills…',
  'search.showing': 'Showing {shown} of {total} skills',
  'search.allShown': 'All {total} skills shown',
  'search.loadMore': 'Load more skills',

  'provider.aria': 'Provider',
  'provider.all': 'All providers',
  'provider.placeholder': 'https://github.com/owner/repo or owner/repo…',
  'provider.refresh': 'Refresh',
  'provider.refreshAll': 'Refresh all',
  'provider.skillCount.one': '{count} skill',
  'provider.skillCount.many': '{count} skills',
  'provider.stars': ' · ★ {count}',
  'provider.lastRefresh.never': 'never refreshed',
  'provider.lastRefresh.justNow': 'refreshed just now',
  'provider.lastRefresh.minutesAgo': 'refreshed {count} min ago',
  'provider.lastRefresh.hoursAgo': 'refreshed {count} h ago',
  'provider.lastRefresh.daysAgo': 'refreshed {count} d ago',
  'provider.empty': 'No providers. Add a GitHub repository that contains skills (directories with a SKILL.md) to download them into the local marketplace.',

  'empty.noInstalled': 'No skills installed in this scope.',
  'empty.noProviders': 'No providers yet. Add a GitHub repository in the Providers tab to search its skills.',
  'empty.noCatalog': 'No skills in the catalog yet — refresh the providers in the Providers tab.',
  'empty.noMatch': 'No skills match this search.',

  'scope.globalStar': '⭐ Global',
  'scope.workspace': 'Workspace',
  'scope.globalOnly': 'Global only',
  'scope.disabledMarker': ' · disabled',
  // The `shadow` badge is asserted verbatim by tests and quoted in host
  // diagnostics, so every locale renders the same word.
  'scope.shadowMarker': ' · shadow',
  'scope.hint': 'Installed-tab scope; toggling off here disables a global skill only in this workspace',

  'presence.global': 'global',
  'presence.workspace.one': '{count} workspace',
  'presence.workspace.many': '{count} workspaces',
  'presence.in': 'in {targets}',

  'action.enable': 'Enable',
  'action.disable': 'Disable',
  'action.remove': 'Remove',
  'action.update': 'Update',
  'action.updateAllCopies': 'Update all copies',
  'action.add': 'Add',
  'action.cancel': 'Cancel',

  'badge.custom': 'custom',

  'aria.viewSkill': 'View {name}',

  'confirm.removeSkillTitle': 'Remove skill "{name}"?',
  'confirm.removeSkillMessage': 'It moves to the .trash directory of its skill root, so it can be restored by hand.',
  'confirm.removeProviderTitle': 'Remove provider "{spec}"?',
  'confirm.removeProviderMessage': 'Its cached catalog is deleted; skills already installed stay installed.',

  'add.title': 'Add skill "{name}"',
  'add.hint': 'Choose where to add it. Targets already holding the skill are marked and locked.',
  'add.added': 'added',
  'add.toTargets': 'Add to {count} targets',

  'detail.aria': 'Skill {name}',
  'detail.modelInvocable': 'model invocable',
  'detail.modelBlocked': 'model blocked',
  'detail.userInvocable': 'user invocable',
  'detail.userBlocked': 'not user invocable',
  'detail.whenToUse': 'When to use: {text}',
  'detail.close': 'Close',

  'error.loadDetail': 'could not load the skill detail',

  'warning.partialAdd': 'Added to {added} of {total} targets; first failure: {first}',

  'status.working': 'Working…',
}

/** Every dictionary key. */
export type MessageKey = keyof typeof en
