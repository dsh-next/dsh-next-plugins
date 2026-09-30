/** @typedef {{ name: string, paths?: string[], title?: string, reviewers?: string[], assignees?: string[] }} ReviewRoute */
/** @typedef {{ routes: ReviewRoute[], defaultRoute?: {reviewers?: string[], assignees?: string[]} }} ReviewConfig */

/**
 * Compile repository path globs: * and ? stay in one segment; ** crosses segments.
 * @param {string} pattern
 * @returns {RegExp}
 */
export function globToRegExp(pattern) {
  if (typeof pattern !== 'string') throw new TypeError('route path must be a string');
  let source = '^';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index++;
      if (pattern[index + 1] === '/') {
        source += '(?:[^/]+/)*';
        index++;
      } else {
        source += '.*';
      }
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(source + '$');
}

function uniqueUsers(users) {
  const seen = new Set();
  return users.filter((login) => {
    const key = login.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Select routes without excluding the author's valid self-assignment.
 * @param {ReviewConfig} config
 * @param {string[]} files
 * @param {string} title
 * @param {string} author
 * @param {(message: string) => void} warn
 * @returns {{matched: ReviewRoute[], reviewers: string[], assignees: string[]}}
 */
export function selectReviewRoutes(config, files, title, author, warn = () => {}) {
  if (!Array.isArray(config.routes)) throw new TypeError('routes must be an array');
  const matched = [];
  const seen = new Set();
  for (const route of config.routes) {
    if (seen.has(route.name)) continue;
    seen.add(route.name);
    const pathHit = (route.paths || []).some((pattern) => {
      const regexp = globToRegExp(pattern);
      return files.some((file) => regexp.test(file));
    });
    let titleHit = false;
    if (route.title) {
      try {
        titleHit = new RegExp(route.title, 'i').test(title || '');
      } catch {
        warn('invalid title regex for route ' + route.name);
      }
    }
    if (pathHit || titleHit) matched.push(route);
  }
  const selected = matched.length ? matched : config.defaultRoute ? [config.defaultRoute] : [];
  return {
    matched,
    reviewers: uniqueUsers(selected.flatMap((route) => route.reviewers || []))
      .filter((login) => login.toLowerCase() !== author.toLowerCase()),
    assignees: uniqueUsers(selected.flatMap((route) => route.assignees || [])),
  };
}

/**
 * Fetch every page before making any routing decision; a truncated API result is not a route match.
 * @param {object} options
 * @param {ReviewConfig} options.config
 * @param {{repo: {owner: string, repo: string}, payload: {action?: string, pull_request?: {number: number, title: string, user: {login: string}, draft?: boolean, changed_files?: number}}}} options.context
 * @param {{info: (message: string) => void, warning: (message: string) => void}} options.core
 * @param {{rest: object, paginate: Function}} options.github GitHub-script's injected client.
 */
export async function routePullRequest({ github, context, core, config }) {
  const pr = context.payload.pull_request;
  if (!pr || pr.draft) return;
  const target = { ...context.repo, pull_number: pr.number };
  const changedFiles = await github.paginate(github.rest.pulls.listFiles, { ...target, per_page: 100 });
  if (!Array.isArray(changedFiles) || changedFiles.some((file) => typeof file.filename !== 'string')) {
    throw new Error('changed-file retrieval is incomplete');
  }
  // GitHub caps this endpoint at 3,000 files. Do not silently route a partial PR.
  if (Number.isInteger(pr.changed_files) && pr.changed_files !== changedFiles.length) {
    throw new Error(`changed-file retrieval is incomplete: expected ${pr.changed_files}, got ${changedFiles.length}`);
  }
  if (!Number.isInteger(pr.changed_files) && changedFiles.length >= 3000) {
    throw new Error('changed-file retrieval is unverifiable at the API cap without an expected count');
  }
  const files = changedFiles.flatMap((file) => file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]);
  const { matched, reviewers, assignees } = selectReviewRoutes(config, files, pr.title, pr.user.login, (message) => core.warning(message));
  core.info(`PR #${pr.number}: ${changedFiles.length} changed files; ${matched.length} review routes matched.`);
  if (reviewers.length) await github.rest.pulls.requestReviewers({ ...target, reviewers });
  if (assignees.length) await github.rest.issues.addAssignees({ ...context.repo, issue_number: pr.number, assignees });
  if (!matched.length || context.payload.action !== 'opened') return;
  const comment = [
    'This PR was routed to category reviewers:',
    '',
    ...matched.map((route) => '- ' + route.name),
    '',
    'Routing rules live in `.github/pr-review-routes.json`.',
  ].join('\n');
  try {
    await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body: comment });
  } catch (error) {
    core.warning('failed to post routing comment: ' + error.message);
  }
}
