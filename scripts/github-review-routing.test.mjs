import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { globToRegExp, routePullRequest, selectReviewRoutes } from './github-review-routing.mjs';

const route = (name, paths, extras = {}) => ({ name, paths, reviewers: ['sitegroove'], assignees: ['sitegroove'], ...extras });
const defaults = { reviewers: ['sitegroove'], assignees: ['sitegroove'] };

for (const [pattern, matches, misses] of [
  ['packages/dsh-next-skills/**', ['packages/dsh-next-skills/package.json', 'packages/dsh-next-skills/src/client/index.ts'], ['packages/dsh-next-notifier/index.ts']],
  ['packages/*/package.json', ['packages/dsh-next-skills/package.json'], ['packages/dsh-next-skills/src/package.json']],
  ['scripts/?.mjs', ['scripts/a.mjs'], ['scripts/aa.mjs', 'scripts/dir/a.mjs']],
  ['src/**/*.ts', ['src/index.ts', 'src/core/policy.ts', 'src/a/b/c.ts'], ['src/index.tsx', 'other/index.ts']],
  ['**/README.md', ['README.md', 'packages/a/README.md'], ['README.md.bak']],
  ['shared/**', ['shared/build.mjs', 'shared/a/b.mjs'], ['sharedness/build.mjs']],
  ['literal/[a](b)+$^.json', ['literal/[a](b)+$^.json'], ['literal/ab.json']],
  ['a\\b', ['a\\b'], ['a/b']],
]) {
  test(`glob ${pattern} respects segment/depth and regex literal semantics`, () => {
    const regexp = globToRegExp(pattern);
    for (const filename of matches) assert.equal(regexp.test(filename), true, filename);
    for (const filename of misses) assert.equal(regexp.test(filename), false, filename);
  });
}

test('invalid glob input fails rather than guessing a route', () => {
  assert.throws(() => globToRegExp(null), /route path must be a string/);
});

test('path and case-insensitive title matches combine routes and deduplicate users', () => {
  const result = selectReviewRoutes({ routes: [
    route('path', ['packages/a/**'], { reviewers: ['alice', 'ALICE', 'author'], assignees: ['author', 'alice'] }),
    route('title', [], { title: '^Fix', reviewers: ['bob'], assignees: ['alice', 'bob'] }),
  ], defaultRoute: defaults }, ['packages/a/src/index.ts'], 'fIx issue', 'AUTHOR');
  assert.deepEqual(result.matched.map(({ name }) => name), ['path', 'title']);
  assert.deepEqual(result.reviewers, ['alice', 'bob']);
  assert.deepEqual(result.assignees, ['author', 'alice', 'bob']);
});

test('duplicate route names preserve first-route behavior', () => {
  const result = selectReviewRoutes({ routes: [route('same', ['a/**']), route('same', ['b/**'])], defaultRoute: defaults }, ['b/file'], '', 'author');
  assert.deepEqual(result.matched, []);
  assert.deepEqual(result.assignees, ['sitegroove']);
});

test('invalid title regex warns without suppressing a valid path match', () => {
  const warnings = [];
  const result = selectReviewRoutes({ routes: [route('a', ['a/**'], { title: '[' })] }, ['a/direct'], '', 'author', (message) => warnings.push(message));
  assert.equal(result.matched.length, 1);
  assert.match(warnings[0], /invalid title regex for route a/);
});

test('default route excludes its author as reviewer but retains self-assignment', () => {
  assert.deepEqual(selectReviewRoutes({ routes: [], defaultRoute: defaults }, ['unknown'], '', 'SiteGroove'), {
    matched: [], reviewers: [], assignees: ['sitegroove'],
  });
});

test('no match without default and routes without user lists produce no requests', () => {
  assert.deepEqual(selectReviewRoutes({ routes: [{ name: 'empty' }] }, ['unknown'], '', 'author'), { matched: [], reviewers: [], assignees: [] });
  const result = selectReviewRoutes({ routes: [{ name: 'empty', title: 'anything' }] }, [], 'anything', 'author');
  assert.deepEqual(result.reviewers, []);
  assert.deepEqual(result.assignees, []);
});

test('config must provide an explicit routes array', () => {
  assert.throws(() => selectReviewRoutes({}, [], '', 'author'), /routes must be an array/);
});

test('all seven current plugins have explicit routes regardless of private manifests', () => {
  const config = JSON.parse(readFileSync(new URL('../.github/pr-review-routes.json', import.meta.url), 'utf8'));
  const plugins = readdirSync(new URL('../packages', import.meta.url)).filter((name) => name.startsWith('dsh-next-')).sort();
  assert.equal(plugins.length, 7);
  assert.deepEqual(config.defaultRoute.reviewers, ['sitegroove']);
  assert.deepEqual(config.defaultRoute.assignees, ['sitegroove']);
  for (const plugin of plugins) {
    for (const path of [`packages/${plugin}/package.json`, `packages/${plugin}/src/client/nested/index.ts`]) {
      const result = selectReviewRoutes(config, [path], '', 'author');
      assert.deepEqual(result.matched.map(({ name }) => name), [plugin.replace('dsh-next-', '')]);
      assert.deepEqual(result.reviewers, ['sitegroove']);
      assert.deepEqual(result.assignees, ['sitegroove']);
    }
  }
});

function mockApi(pages, failure) {
  const calls = [];
  const github = { rest: { pulls: {}, issues: {} } };
  github.rest.pulls.listFiles = async (params) => {
    calls.push({ method: 'listFiles', params });
    if (failure === 'listFiles') throw new Error('file retrieval failed');
    return { data: pages[params.page - 1] || [] };
  };
  github.paginate = async (method, params) => {
    const files = [];
    for (let page = 1; ; page++) {
      const response = await method({ ...params, page });
      files.push(...response.data);
      if (response.data.length < params.per_page) return files;
    }
  };
  for (const [area, method] of [['pulls', 'requestReviewers'], ['issues', 'addAssignees'], ['issues', 'createComment']]) {
    github.rest[area][method] = async (params) => {
      calls.push({ method, params });
      if (failure === method) throw new Error(`${method} failed`);
    };
  }
  const warnings = [];
  const core = { info() {}, warning(message) { warnings.push(message); } };
  return { github, calls, core, warnings };
}
function context(overrides = {}, action = 'opened') {
  return { repo: { owner: 'org', repo: 'plugins' }, payload: { action, pull_request: { number: 42, title: 'a PR', user: { login: 'author' }, ...overrides } } };
}
const config = { routes: [route('skills', ['packages/dsh-next-skills/**'])], defaultRoute: defaults };

test('pagination reaches a matched file beyond the former 300-file cap', async () => {
  const filler = Array.from({ length: 100 }, (_, index) => ({ filename: `unrelated/${index}.txt` }));
  const api = mockApi([filler, filler, filler, [{ filename: 'packages/dsh-next-skills/src/core/policy.ts' }]]);
  await routePullRequest({ ...api, context: context({ changed_files: 301 }), config });
  assert.deepEqual(api.calls.filter(({ method }) => method === 'listFiles').map(({ params }) => params.page), [1, 2, 3, 4]);
  assert.ok(api.calls.filter(({ method }) => method === 'listFiles').every(({ params }) => params.per_page === 100));
  assert.deepEqual(api.calls.filter(({ method }) => method !== 'listFiles').map(({ method }) => method), ['requestReviewers', 'addAssignees', 'createComment']);
  assert.match(api.calls.at(-1).params.body, /- skills/);
});

test('renames route both the old and new package paths', async () => {
  const api = mockApi([[{ filename: 'other/new.ts', previous_filename: 'packages/dsh-next-skills/old.ts' }]]);
  await routePullRequest({ ...api, context: context(), config });
  assert.match(api.calls.at(-1).params.body, /- skills/);
});

test('author is assigned on matched and fallback routes but is never asked to self-review', async () => {
  for (const filename of ['packages/dsh-next-skills/index.ts', 'unknown.txt']) {
    const api = mockApi([[{ filename }]]);
    await routePullRequest({ ...api, context: context({ user: { login: 'SITEGROOVE' } }), config });
    assert.equal(api.calls.some(({ method }) => method === 'requestReviewers'), false);
    assert.deepEqual(api.calls.find(({ method }) => method === 'addAssignees').params.assignees, ['sitegroove']);
  }
});

for (const action of ['synchronize', 'reopened', 'ready_for_review']) {
  test(`${action} routes without another opening comment`, async () => {
    const api = mockApi([[{ filename: 'packages/dsh-next-skills/index.ts' }]]);
    await routePullRequest({ ...api, context: context({}, action), config });
    assert.equal(api.calls.some(({ method }) => method === 'createComment'), false);
  });
}

test('missing PR, draft PR, or unmatched/no-default produce no writes', async () => {
  for (const ctx of [{ repo: {}, payload: {} }, context({ draft: true }), context()]) {
    const api = mockApi([[{ filename: 'unknown' }]]);
    await routePullRequest({ ...api, context: ctx, config: { routes: [] } });
    assert.equal(api.calls.some(({ method }) => method !== 'listFiles'), false);
  }
});

test('truncated, malformed and failed file retrieval make no requests', async () => {
  for (const [pages, failure, pr] of [
    [[[{ filename: 'unknown' }]], undefined, { changed_files: 2 }],
    [[[{}]], undefined, {}],
    [[], 'listFiles', {}],
  ]) {
    const api = mockApi(pages, failure);
    await assert.rejects(routePullRequest({ ...api, context: context(pr), config }), /incomplete|retrieval failed/);
    assert.equal(api.calls.some(({ method }) => method !== 'listFiles'), false);
  }
});

test('unknown or malformed expected count cannot silently accept a capped inventory', async () => {
  const fullPage = Array.from({ length: 100 }, (_, index) => ({ filename: `src/${index}.ts` }));
  for (const changed_files of [undefined, '3000', null]) {
    const api = mockApi(Array.from({ length: 30 }, () => fullPage));
    await assert.rejects(routePullRequest({ ...api, context: context({ changed_files }), config }), /unverifiable at the API cap/);
    assert.equal(api.calls.some(({ method }) => method !== 'listFiles'), false);
  }
});

for (const failure of ['requestReviewers', 'addAssignees']) {
  test(`${failure} errors propagate without a misleading routing comment`, async () => {
    const api = mockApi([[{ filename: 'packages/dsh-next-skills/index.ts' }]], failure);
    await assert.rejects(routePullRequest({ ...api, context: context(), config }), new RegExp(`${failure} failed`));
    assert.equal(api.calls.some(({ method }) => method === 'createComment'), false);
  });
}

test('routing-comment failure warns without undoing successful routing', async () => {
  const api = mockApi([[{ filename: 'packages/dsh-next-skills/index.ts' }]], 'createComment');
  await routePullRequest({ ...api, context: context(), config });
  assert.match(api.warnings[0], /failed to post routing comment/);
});

test('PR-target workflow checks out only immutable trusted base and imports absolute workspace helper/config', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/auto-assign-pr-reviewers.yml', import.meta.url), 'utf8'));
  assert.ok(workflow.on.pull_request_target);
  const [checkout, script] = workflow.jobs.route.steps;
  assert.equal(checkout.with.ref, '${{ github.event.pull_request.base.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.match(script.with.script, /process\.env\.GITHUB_WORKSPACE/);
  assert.match(script.with.script, /import\(pathToFileURL\(/);
  assert.match(script.with.script, /readFile\(workspace \+ '\/\.github\/pr-review-routes\.json'/);
  assert.equal(script.uses, 'actions/github-script@v8');
  assert.doesNotMatch(JSON.stringify(workflow), /pull_request\.head|import\(['"]\.\//);
});
