import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { staleAssignees, staleAssignmentPolicy, sweepStaleAssignments } from './github-stale-assignment.mjs';

const now = Date.parse('2026-09-30T12:00:00Z');
const cutoff = now - 14 * 86400000;
const old = '2026-09-01T12:00:00Z';
const recent = '2026-09-29T12:00:00Z';
const boundary = new Date(cutoff).toISOString();
const user = (login) => ({ login });
const assigned = (login = 'alice', created_at = old) => ({ event: 'assigned', assignee: user(login), created_at });
const item = (assignees = ['alice', 'unrelated']) => ({ number: 42, pull_request: {}, assignees: assignees.map(user), updated_at: old });
const config = { routes: [{ assignees: ['alice', 'bob'] }], defaultRoute: { assignees: ['sitegroove'] } };
const policy = staleAssignmentPolicy(config);
const history = (overrides = {}) => ({ events: [assigned()], comments: [], reviews: [], ...overrides });

function apiFixture(overrides = {}) {
  const fixture = {
    listForRepo: [item()], listEvents: [assigned()], listComments: [], listReviews: [],
    fresh: item(), added: { ...item(), assignees: ['alice', 'unrelated', 'sitegroove'].map(user) },
    fallbackUser: { login: 'sitegroove', type: 'User' }, assignability: 204,
    ...overrides,
  };
  const calls = [];
  const warnings = [];
  const core = { info() {}, warning(message) { warnings.push(message); } };
  const github = { rest: { issues: {}, pulls: {}, users: {} } };
  const record = (method, params) => {
    calls.push({ method, params });
    if (fixture.failure?.method === method && (!fixture.failure.page || fixture.failure.page === params.page)) {
      throw new Error(`${method} failed`);
    }
  };
  for (const [area, method] of [['issues', 'listForRepo'], ['issues', 'listEvents'], ['issues', 'listComments'], ['pulls', 'listReviews']]) {
    github.rest[area][method] = async (params) => {
      record(method, params);
      const source = typeof fixture[method] === 'function' ? fixture[method](params) : fixture[method];
      if (!Array.isArray(source)) return { data: source };
      return { data: source.slice((params.page - 1) * params.per_page, params.page * params.per_page) };
    };
  }
  github.paginate = async (method, params) => {
    const results = [];
    for (let page = 1; ; page++) {
      const { data } = await method({ ...params, page });
      if (!Array.isArray(data)) return data;
      results.push(...data);
      if (data.length < params.per_page) return results;
    }
  };
  github.rest.users.getByUsername = async (params) => { record('getByUsername', params); return { data: fixture.fallbackUser }; };
  github.rest.issues.checkUserCanBeAssignedAssignee = async (params) => { record('checkUserCanBeAssignedAssignee', params); return { status: fixture.assignability }; };
  github.rest.issues.get = async (params) => { record('get', params); return { data: fixture.fresh }; };
  github.rest.issues.addAssignees = async (params) => { record('addAssignees', params); return { data: fixture.added }; };
  github.rest.issues.removeAssignees = async (params) => { record('removeAssignees', params); return { data: {} }; };
  github.rest.issues.createComment = async (params) => { record('createComment', params); return { data: {} }; };
  return { fixture, calls, warnings, github, core };
}
const context = { repo: { owner: 'dsh-next-organization', repo: 'plugins' } };
const sweep = (api, customConfig = config, options = {}) => sweepStaleAssignments({ ...api, context, config: customConfig, now, ...options });
const writes = (api) => api.calls.filter(({ method }) => ['addAssignees', 'removeAssignees', 'createComment'].includes(method));

// Pure policy tests pin the decision seam independently of GitHub API mutation.
test('fallback comes from owning default assignees, not repository owner, and tracked users deduplicate', () => {
  assert.deepEqual(staleAssignmentPolicy({ routes: [{ assignees: ['Alice', 'alice', 'owner-user'] }], defaultRoute: { assignees: ['owner-user'] } }), { fallback: 'owner-user', tracked: ['alice'] });
  assert.deepEqual(staleAssignmentPolicy({ routes: [{ assignees: ['alice'] }] }), { fallback: 'sitegroove', tracked: ['alice'] });
});

test('all current sitegroove routes have nothing to remove from fallback', () => {
  const checkedIn = JSON.parse(readFileSync(new URL('../.github/pr-review-routes.json', import.meta.url), 'utf8'));
  assert.deepEqual(staleAssignmentPolicy(checkedIn), { fallback: 'sitegroove', tracked: [] });
});

for (const invalid of [{}, { routes: [], defaultRoute: { assignees: 'alice' } }, { routes: [{ assignees: 'bob' }] }, { routes: [{ assignees: ['@org'] }] }, { routes: [], defaultRoute: { assignees: ['name with spaces'] } }]) {
  test(`invalid policy fails closed: ${JSON.stringify(invalid)}`, () => {
    assert.throws(() => staleAssignmentPolicy(invalid), /routes must|route assignees must/);
  });
}

test('only old inactive configured assignees are stale; unrelated users are preserved', () => {
  assert.deepEqual(staleAssignees(item(), policy, history(), cutoff), ['alice']);
});

test('already-fallback and wholly unrelated assignments are not candidates', () => {
  assert.deepEqual(staleAssignees(item(['alice', 'SiteGroove']), policy, {}, cutoff), []);
  assert.deepEqual(staleAssignees(item(['unrelated']), policy, {}, cutoff), []);
});

for (const assignmentDate of [recent, boundary]) {
  test(`new or cutoff assignment is not stale: ${assignmentDate}`, () => {
    assert.deepEqual(staleAssignees(item(), policy, history({ events: [assigned('alice', assignmentDate)] }), cutoff), []);
  });
}

test('latest assignment is used even when events arrive out of order', () => {
  assert.deepEqual(staleAssignees(item(), policy, history({ events: [assigned('alice', recent), assigned('alice', old)] }), cutoff), []);
});

for (const activity of [
  { comments: [{ user: user('ALICE'), created_at: recent }] },
  { comments: [{ user: user('alice'), created_at: old, updated_at: boundary }] },
  { reviews: [{ user: user('alice'), submitted_at: recent }] },
  { reviews: [{ user: user('alice'), submitted_at: boundary }] },
]) {
  test(`recent maintainer response prevents removal: ${JSON.stringify(activity)}`, () => {
    assert.deepEqual(staleAssignees(item(), policy, history(activity), cutoff), []);
  });
}

test('old responses and unrelated bot comments do not hide an inactive assignment', () => {
  assert.deepEqual(staleAssignees(item(), policy, history({
    comments: [{ user: user('alice'), created_at: old }, { user: user('dependabot[bot]'), created_at: recent }],
    reviews: [{ user: user('alice'), submitted_at: old }],
  }), cutoff), ['alice']);
});

for (const incomplete of [
  { events: [] },
  { events: [assigned('alice', 'not-a-date')] },
  { events: [assigned('alice', null)] },
  { events: [{ event: 'assigned' }] },
  { events: [{}] },
  { events: [assigned(), { event: 'unassigned', assignee: user('alice'), created_at: recent }] },
  { comments: null },
  { comments: [{ user: null, created_at: recent }] },
  { comments: [{ user: user('alice') }] },
  { comments: [{ user: user('alice'), created_at: old, updated_at: 'broken' }] },
  { reviews: [{ user: user('alice'), state: 'PENDING', submitted_at: null }] },
]) {
  test(`unknown/incomplete assignment or activity fails safe: ${JSON.stringify(incomplete)}`, () => {
    assert.throws(() => staleAssignees(item(), policy, history(incomplete), cutoff), /unknown|invalid|incomplete|disagrees/);
  });
}

test('incomplete assignee list cannot trigger removal', () => {
  assert.throws(() => staleAssignees({ number: 42 }, policy, history(), cutoff), /incomplete assignee/);
  assert.throws(() => staleAssignees(item(['']), policy, history(), cutoff), /incomplete assignee/);
});

// Orchestration tests only use mocked APIs, including every write endpoint.
test('safe reassignment adds a confirmed user fallback before removing only the stale assignee', async () => {
  const api = apiFixture();
  assert.deepEqual(await sweep(api), { reassigned: 1 });
  assert.deepEqual(writes(api).map(({ method }) => method), ['addAssignees', 'removeAssignees', 'createComment']);
  assert.deepEqual(writes(api)[0].params.assignees, ['sitegroove']);
  assert.deepEqual(writes(api)[1].params.assignees, ['alice']);
  assert.match(writes(api)[2].params.body, /Automatically reassigned to @sitegroove/);
  assert.ok(api.calls.every(({ params }) => !params.assignees?.includes(context.repo.owner)));
});

test('configured fallback is preferred to sitegroove and verified as a user', async () => {
  const api = apiFixture({ fallbackUser: { login: 'owner-user', type: 'User' }, added: item(['alice', 'unrelated', 'owner-user']) });
  const customConfig = { ...config, defaultRoute: { assignees: ['owner-user'] } };
  assert.deepEqual(await sweep(api, customConfig), { reassigned: 1 });
  assert.equal(api.calls[0].params.username, 'owner-user');
  assert.deepEqual(writes(api)[0].params.assignees, ['owner-user']);
});

test('empty policy skips without API calls; no open PRs or only issues/untracked/fallback cause no writes', async () => {
  const empty = apiFixture();
  assert.deepEqual(await sweep(empty, { routes: [], defaultRoute: { assignees: ['sitegroove'] } }), { reassigned: 0 });
  assert.deepEqual(empty.calls, []);
  for (const listForRepo of [[], [{ ...item(), pull_request: undefined }], [item(['unrelated'])], [item(['alice', 'sitegroove'])]]) {
    const api = apiFixture({ listForRepo });
    assert.deepEqual(await sweep(api), { reassigned: 0 });
    assert.deepEqual(writes(api), []);
    assert.equal(api.calls.some(({ method }) => method === 'listEvents'), false);
  }
});

test('items are deduplicated across assignee searches and all stale candidates are removed, not others', async () => {
  const both = item(['alice', 'bob', 'unrelated']);
  const api = apiFixture({ listForRepo: [both], fresh: both, added: item(['alice', 'bob', 'unrelated', 'sitegroove']), listEvents: [assigned('alice'), assigned('bob')] });
  assert.deepEqual(await sweep(api), { reassigned: 1 });
  assert.deepEqual(writes(api).find(({ method }) => method === 'removeAssignees').params.assignees, ['alice', 'bob']);
});

test('mixed active and stale assignees retain active and unrelated users', async () => {
  const both = item(['alice', 'bob', 'unrelated']);
  const api = apiFixture({ listForRepo: [both], fresh: both, added: item(['alice', 'bob', 'unrelated', 'sitegroove']), listEvents: [assigned('alice'), assigned('bob')], listComments: [{ user: user('bob'), created_at: recent }] });
  assert.deepEqual(await sweep(api), { reassigned: 1 });
  assert.deepEqual(writes(api).find(({ method }) => method === 'removeAssignees').params.assignees, ['alice']);
});

test('items beyond page 1 are swept', async () => {
  const ordinaryIssues = Array.from({ length: 100 }, (_, index) => ({ ...item(), number: index + 100, pull_request: undefined }));
  const api = apiFixture({ listForRepo: [...ordinaryIssues, item()] });
  assert.deepEqual(await sweep(api), { reassigned: 1 });
  assert.equal(api.calls.filter(({ method, params }) => method === 'listForRepo' && params.page === 2).length, 2);
});

for (const [method, filler, last] of [
  ['listEvents', { event: 'labeled', created_at: old }, assigned('alice', recent)],
  ['listComments', { user: user('other'), created_at: old }, { user: user('alice'), created_at: recent }],
  ['listReviews', { user: user('other'), submitted_at: old }, { user: user('alice'), submitted_at: recent }],
]) {
  test(`${method} pagination sees late recent activity and prevents reassignment`, async () => {
    const first = Array.from({ length: 100 }, () => filler);
    const api = apiFixture({ [method]: [...first, last] });
    assert.deepEqual(await sweep(api), { reassigned: 0 });
    assert.ok(api.calls.some((call) => call.method === method && call.params.page === 2));
    assert.deepEqual(writes(api), []);
  });
}

for (const failure of ['getByUsername', 'checkUserCanBeAssignedAssignee', 'listForRepo']) {
  test(`${failure} failure aborts safely before any mutations`, async () => {
    const api = apiFixture({ failure: { method: failure } });
    await assert.rejects(sweep(api), new RegExp(`${failure} failed`));
    assert.deepEqual(writes(api), []);
  });
}

for (const invalid of [
  { fallbackUser: { login: 'sitegroove', type: 'Organization' } },
  { fallbackUser: { login: 'different', type: 'User' } },
  { assignability: 404 },
  { listForRepo: null },
  { listForRepo: [{}] },
]) {
  test(`invalid fallback/item retrieval aborts safely: ${JSON.stringify(invalid)}`, async () => {
    const api = apiFixture(invalid);
    await assert.rejects(sweep(api), /fallback|incomplete assigned-item/);
    assert.deepEqual(writes(api), []);
  });
}

for (const method of ['listForRepo', 'listEvents', 'listComments', 'listReviews']) {
  test(`${method} later-page API failure never removes an assignee`, async () => {
    const filler = method === 'listForRepo' ? { ...item(), pull_request: undefined } : method === 'listEvents' ? assigned() : { user: user('alice'), created_at: old, submitted_at: old };
    const api = apiFixture({ [method]: Array.from({ length: 101 }, () => filler), failure: { method, page: 2 } });
    if (method === 'listForRepo') await assert.rejects(sweep(api), /listForRepo failed/);
    else {
      assert.deepEqual(await sweep(api), { reassigned: 0 });
      assert.match(api.warnings[0], new RegExp(`${method} failed`));
    }
    assert.deepEqual(writes(api), []);
  });
}

for (const invalid of [
  { listEvents: [] }, { listEvents: null }, { listComments: null }, { listReviews: null },
  { listComments: [{ user: user('alice') }] },
  { listReviews: [{ user: user('alice'), submitted_at: null }] },
  { listForRepo: [item([''])] },
  { fresh: { ...item(), updated_at: null } },
]) {
  test(`unknown history and incomplete activity preserve existing assignees: ${JSON.stringify(invalid)}`, async () => {
    const api = apiFixture(invalid);
    assert.deepEqual(await sweep(api), { reassigned: 0 });
    assert.deepEqual(writes(api), []);
    assert.equal(api.warnings.length, 1);
  });
}

for (const fresh of [item(['alice', 'sitegroove']), item(['unrelated']), { ...item(), updated_at: recent }]) {
  test(`changed current PR waits for another sweep: ${JSON.stringify(fresh)}`, async () => {
    const api = apiFixture({ fresh });
    assert.deepEqual(await sweep(api), { reassigned: 0 });
    assert.deepEqual(writes(api), []);
  });
}

test('failure to refresh current assignees preserves all existing users', async () => {
  const api = apiFixture({ failure: { method: 'get' } });
  assert.deepEqual(await sweep(api), { reassigned: 0 });
  assert.deepEqual(writes(api), []);
});

for (const added of [item(), { assignees: [] }, {}, { assignees: [{ login: '' }] }]) {
  test(`unconfirmed fallback addition never removes original assignees: ${JSON.stringify(added)}`, async () => {
    const api = apiFixture({ added });
    assert.deepEqual(await sweep(api), { reassigned: 0 });
    assert.deepEqual(writes(api).map(({ method }) => method), ['addAssignees']);
    assert.equal(api.warnings.length, 1);
  });
}

for (const extra of ['bob', 'new-maintainer']) {
  test(`a concurrent assignee addition preserves all users before removal: ${extra}`, async () => {
    const added = { ...item(), assignees: ['alice', 'unrelated', 'sitegroove', extra].map(user) };
    const api = apiFixture({ added });
    assert.deepEqual(await sweep(api), { reassigned: 0 });
    assert.deepEqual(writes(api).map(({ method }) => method), ['addAssignees']);
    assert.match(api.warnings[0], /assignees changed while adding fallback/);
  });
}

for (const failure of ['addAssignees', 'removeAssignees']) {
  test(`${failure} failure avoids a success notification`, async () => {
    const api = apiFixture({ failure: { method: failure } });
    assert.deepEqual(await sweep(api), { reassigned: 0 });
    assert.equal(writes(api).some(({ method }) => method === 'createComment'), false);
    assert.match(api.warnings[0], new RegExp(`${failure} failed`));
  });
}

test('notification failure does not misreport a completed reassignment as unperformed', async () => {
  const api = apiFixture({ failure: { method: 'createComment' } });
  assert.deepEqual(await sweep(api), { reassigned: 1 });
  assert.match(api.warnings[0], /reassigned, but notification failed/);
});

for (const options of [{ now: NaN }, { days: 0 }, { days: -1 }]) {
  test(`invalid stale interval is rejected: ${JSON.stringify(options)}`, async () => {
    const api = apiFixture();
    await assert.rejects(sweep(api, config, options), /invalid stale interval/);
    assert.deepEqual(writes(api), []);
  });
}

test('sweep workflow loads policy/config only from trusted checkout and absolute module path', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/stale-assignment.yml', import.meta.url), 'utf8'));
  const [checkout, script] = workflow.jobs.sweep.steps;
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(script.uses, 'actions/github-script@v8');
  assert.match(script.with.script, /import\(pathToFileURL\(/);
  assert.match(script.with.script, /process\.env\.GITHUB_WORKSPACE/);
  assert.doesNotMatch(script.with.script, /pull_request\.head|import\(['"]\.\//);
});
