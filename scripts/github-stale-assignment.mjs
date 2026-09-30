/** @typedef {{ routes: Array<{assignees?: string[]}>, defaultRoute?: {assignees?: string[]} }} AssignmentConfig */
/** @typedef {{ login: string }} Assignee */
/** @typedef {{ number: number, pull_request?: object, assignees: Assignee[], updated_at?: string }} AssignedItem */
/** @typedef {{fallback: string, tracked: string[]}} AssignmentPolicy */
/** @typedef {{event: string, assignee?: Assignee, created_at?: string}} AssignmentEvent */
/** @typedef {{user: {login: string} | null, created_at?: string, submitted_at?: string | null, updated_at?: string}} MaintainerActivity */

const validLogin = (login) => typeof login === 'string' && /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(login);
const key = (login) => login.toLowerCase();

/** The repository owner can be an organization; it is never an implicit assignee. @param {AssignmentConfig} config */
export function staleAssignmentPolicy(config) {
  if (!Array.isArray(config.routes)) throw new TypeError('routes must be an array');
  const defaults = config.defaultRoute?.assignees || [];
  if (!Array.isArray(defaults) || config.routes.some((route) => route.assignees != null && !Array.isArray(route.assignees))) {
    throw new TypeError('route assignees must be arrays');
  }
  const users = [...defaults, ...config.routes.flatMap((route) => route.assignees || [])];
  if (users.some((login) => !validLogin(login))) throw new TypeError('route assignees must be valid GitHub user logins');
  const fallback = defaults[0] || 'sitegroove';
  return { fallback, tracked: [...new Set(users.map(key))].filter((login) => login !== key(fallback)) };
}

function timestamp(value) {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(time)) throw new Error('missing or invalid activity timestamp');
  return time;
}

function assigneeLogins(item) {
  if (!Array.isArray(item.assignees) || item.assignees.some((user) => !validLogin(user?.login))) {
    throw new Error('incomplete assignee retrieval');
  }
  return item.assignees.map((user) => user.login);
}

/**
 * Decide only from complete, timestamped assignment and maintainer activity history.
 * @param {AssignedItem} item
 * @param {AssignmentPolicy} policy
 * @param {{events: AssignmentEvent[], comments: MaintainerActivity[], reviews: MaintainerActivity[]}} history
 * @param {number} cutoff
 * @returns {string[]}
 */
export function staleAssignees(item, policy, { events, comments, reviews }, cutoff) {
  const logins = assigneeLogins(item);
  if (logins.some((login) => key(login) === key(policy.fallback))) return [];
  const candidates = logins.filter((login) => policy.tracked.includes(key(login)));
  if (!candidates.length) return [];
  if (![events, comments, reviews].every(Array.isArray)) throw new Error('incomplete activity retrieval');
  const stale = [];
  for (const login of candidates) {
    const assignmentEvents = events.filter((event) => {
      if (typeof event.event !== 'string') throw new Error('incomplete assignment event');
      if (!['assigned', 'unassigned'].includes(event.event)) return false;
      if (!validLogin(event.assignee?.login)) throw new Error('incomplete assignment event');
      return key(event.assignee.login) === key(login);
    });
    // Missing assignment history is unknown, not evidence of an old assignment.
    if (!assignmentEvents.length) throw new Error('assignment age is unknown for ' + login);
    const latest = assignmentEvents.map((event) => ({ event: event.event, time: timestamp(event.created_at) }))
      .sort((a, b) => b.time - a.time)[0];
    if (latest.event !== 'assigned') throw new Error('assignment history disagrees with current assignees');
    if (latest.time >= cutoff) continue;
    let active = false;
    for (const activity of [...comments, ...reviews]) {
      if (typeof activity.user?.login !== 'string' || !activity.user.login) throw new Error('activity author is unknown');
      if (key(activity.user.login) !== key(login)) continue;
      const date = activity.submitted_at || activity.created_at;
      const activityAt = timestamp(date);
      const updatedAt = activity.updated_at == null ? activityAt : timestamp(activity.updated_at);
      if (Math.max(activityAt, updatedAt) >= cutoff) active = true;
    }
    if (!active) stale.push(login);
  }
  return stale;
}

/**
 * Paginate reads, fail safe on unknown activity, and confirm fallback addition before removing only stale users.
 * @param {object} options
 * @param {AssignmentConfig} options.config
 * @param {{repo: {owner: string, repo: string}}} options.context
 * @param {{info: (message: string) => void, warning: (message: string) => void}} options.core
 * @param {{rest: object, paginate: Function}} options.github GitHub-script's injected client.
 * @param {number} [options.now]
 * @param {number} [options.days]
 * @returns {Promise<{reassigned: number}>}
 */
export async function sweepStaleAssignments({ github, context, core, config, now = Date.now(), days = 14 }) {
  const policy = staleAssignmentPolicy(config);
  const result = { reassigned: 0 };
  if (!policy.tracked.length) {
    core.info('No non-fallback route assignees to sweep.');
    return result;
  }
  if (!Number.isFinite(now) || !Number.isFinite(days) || days <= 0) throw new TypeError('invalid stale interval');
  const cutoff = now - days * 86400000;
  const repo = context.repo;
  const fallbackUser = await github.rest.users.getByUsername({ username: policy.fallback });
  if (fallbackUser.data?.type !== 'User' || key(fallbackUser.data.login || '') !== key(policy.fallback)) {
    throw new Error('fallback assignee must be a GitHub user, not a repository organization');
  }
  const assignability = await github.rest.issues.checkUserCanBeAssignedAssignee({ ...repo, assignee: policy.fallback });
  if (assignability.status !== 204) throw new Error('fallback user cannot be assigned to this repository');

  const items = new Map();
  // Finish all item pagination before acting, so an API failure cannot leave a
  // partially retrieved candidate set looking like a successful sweep.
  for (const assignee of policy.tracked) {
    const assigned = await github.paginate(github.rest.issues.listForRepo, { ...repo, state: 'open', assignee, per_page: 100 });
    if (!Array.isArray(assigned)) throw new Error('incomplete assigned-item retrieval');
    for (const item of assigned) {
      if (!Number.isInteger(item.number)) throw new Error('incomplete assigned-item retrieval');
      items.set(item.number, item);
    }
  }
  for (const item of items.values()) {
    if (!item.pull_request) continue;
    const target = { ...repo, issue_number: item.number };
    try {
      const logins = assigneeLogins(item);
      if (logins.some((login) => key(login) === key(policy.fallback))) continue;
      if (!logins.some((login) => policy.tracked.includes(key(login)))) continue;
      const events = await github.paginate(github.rest.issues.listEvents, { ...target, per_page: 100 });
      const comments = await github.paginate(github.rest.issues.listComments, { ...target, per_page: 100 });
      const reviews = await github.paginate(github.rest.pulls.listReviews, { ...repo, pull_number: item.number, per_page: 100 });
      const stale = staleAssignees(item, policy, { events, comments, reviews }, cutoff);
      if (!stale.length) continue;

      // Recheck current assignees after activity reads; a changed item waits for
      // the next sweep instead of racing a maintainer's edits or reassignment.
      const fresh = (await github.rest.issues.get(target)).data;
      const current = assigneeLogins(fresh);
      if (current.some((login) => key(login) === key(policy.fallback))) continue;
      if (timestamp(item.updated_at) !== timestamp(fresh.updated_at)) continue;
      if (logins.map(key).sort().join(',') !== current.map(key).sort().join(',')) continue;

      const added = await github.rest.issues.addAssignees({ ...target, assignees: [policy.fallback] });
      const confirmed = assigneeLogins(added.data);
      if (!confirmed.some((login) => key(login) === key(policy.fallback))) {
        throw new Error('fallback addition was not confirmed; preserving existing assignees');
      }
      const others = confirmed.filter((login) => key(login) !== key(policy.fallback)).map(key).sort().join(',');
      if (others !== current.map(key).sort().join(',')) {
        throw new Error('assignees changed while adding fallback; preserving existing assignees');
      }
      // GitHub has no compare-and-swap for these endpoints. This last response
      // check narrows the write window; it cannot make add/remove atomic.
      await github.rest.issues.removeAssignees({ ...target, assignees: stale });
      result.reassigned++;
      core.info(`PR #${item.number}: reassigned ${stale.join(', ')} to ${policy.fallback}.`);
      try {
        await github.rest.issues.createComment({
          ...target,
          body: [
            `Maintainer(s) ${stale.map((login) => '@' + login).join(', ')} were assigned for more than ${days} days without responding.`,
            `Automatically reassigned to @${policy.fallback}; reassign back if still wanted.`,
          ].join('\n'),
        });
      } catch (error) {
        core.warning(`PR #${item.number}: reassigned, but notification failed: ${error.message}`);
      }
    } catch (error) {
      core.warning(`PR #${item.number}: stale reassignment skipped or incomplete: ${error.message}`);
    }
  }
  core.info(`Total reassigned: ${result.reassigned}.`);
  return result;
}
