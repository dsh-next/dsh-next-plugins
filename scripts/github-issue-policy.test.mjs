import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';
import { enforceIssueTemplate, validateIssue } from './github-issue-policy.mjs';

const loadForm = (filename) => parse(readFileSync(new URL(`../.github/ISSUE_TEMPLATE/${filename}`, import.meta.url), 'utf8'));
const bugForm = loadForm('bug_report.yml');
const standardForm = loadForm('standard_issue.yml');

// GitHub emits a heading for each non-markdown field. Generate fixtures from
// the actual forms so changes to their labels cannot silently break validation.
function formIssue(form, answers = {}) {
  return {
    number: 42,
    labels: (form.labels || []).map((name) => ({ name })),
    body: form.body.filter((field) => field.type !== 'markdown').map((field) => {
      const value = Object.hasOwn(answers, field.attributes.label) ? answers[field.attributes.label]
        : field.id === 'issue-type' ? field.attributes.options[0]
          : field.id === 'bug-screenshot' ? '![Bug](https://example.test/image.png)'
            : field.type === 'checkboxes' ? '- [x] I searched existing issues.' : 'Completed field.';
      return `### ${field.attributes.label}\n\n${value}\n`;
    }).join('\n'),
  };
}

for (const type of standardForm.body.find((field) => field.id === 'issue-type').attributes.options) {
  test(`actual standard form validates ${type} without reproduction or screenshots`, () => {
    const result = validateIssue(formIssue(standardForm, { 'Issue type': type }));
    assert.equal(result.valid, true);
    assert.ok(result.requiredSections.includes('Details / context'));
    assert.ok(!result.requiredSections.includes('Details / reproduction'));
    assert.ok(!result.requiredSections.includes('Bug screenshot'));
  });
}

test('actual bug form requires reproduction and image evidence', () => {
  const result = validateIssue(formIssue(bugForm));
  assert.equal(result.valid, true);
  assert.ok(result.requiredSections.includes('Details / reproduction'));
  assert.ok(result.requiredSections.includes('Bug screenshot'));
});

for (const form of [bugForm, standardForm]) {
  for (const field of form.body.filter((field) => field.validations?.required)) {
    for (const blank of ['', '_No response_', ' No response ', '<!-- template hint -->']) {
      test(`${form.name}: ${field.attributes.label} rejects ${JSON.stringify(blank)}`, () => {
        const result = validateIssue(formIssue(form, { [field.attributes.label]: blank }));
        assert.equal(result.valid, false);
        assert.ok(result.missingSections.includes(field.attributes.label));
      });
    }
  }
}

for (const labels of [[{ name: 'BuG' }], ['bug']]) {
  test('bug label cannot bypass reproduction or screenshot requirements with standard issue type', () => {
    const issue = formIssue(standardForm);
    issue.labels = labels;
    assert.deepEqual(validateIssue(issue).missingSections, ['Details / reproduction', 'Bug screenshot']);
  });
}

test('bug issue type requires image evidence even without a bug label', () => {
  const issue = formIssue(bugForm, { 'Issue type': ' BUG REPORT ', 'Bug screenshot': 'See the logs.' });
  issue.labels = [];
  const result = validateIssue(issue);
  assert.equal(result.valid, false);
  assert.equal(result.invalidSections.length, 1);
});

for (const screenshot of [
  '![Bug](https://example.test/screenshot.png)',
  'https://github.com/user-attachments/assets/01234567-abcd',
  'https://github.com/org/repo/assets/1234/abcdef',
  'https://user-images.githubusercontent.com/1234/image',
  'https://example.test/screen.jpg?raw=true',
  'https://example.test/screen.jpeg',
  'https://example.test/screen.gif',
  'https://example.test/screen.webp#preview',
]) {
  test(`bug screenshot accepts evidence ${screenshot}`, () => {
    assert.equal(validateIssue(formIssue(bugForm, { 'Bug screenshot': screenshot })).valid, true);
  });
}

for (const screenshot of ['Screenshot attached later.', 'https://example.test/logs.txt', 'https://example.test/issue/123']) {
  test(`bug screenshot rejects non-image evidence ${screenshot}`, () => {
    assert.equal(validateIssue(formIssue(bugForm, { 'Bug screenshot': screenshot })).invalidSections.length, 1);
  });
}

test('heading parsing tolerates case and CRLF, removes hints and stops at the next empty heading', () => {
  const issue = formIssue(standardForm);
  issue.body = issue.body.replace('### Summary\n\nCompleted field.', '### SUMMARY\n\n<!-- hint --> Real summary.').replaceAll('\n', '\r\n');
  assert.equal(validateIssue(issue).valid, true);
  issue.body = issue.body.replace('### SUMMARY\r\n\r\n<!-- hint --> Real summary.', '### SUMMARY\r\n\r\n');
  assert.deepEqual(validateIssue(issue).missingSections, ['Summary']);
});

test('missing body and missing labels are safely invalid', () => {
  assert.equal(validateIssue({ number: 1 }).missingSections.length, 6);
  assert.equal(validateIssue({ number: 1, body: null, labels: [{}, 'feature'] }).valid, false);
});

test('all seven plugins, including private ones, are offered in both forms', () => {
  const plugins = readdirSync(new URL('../packages', import.meta.url)).filter((name) => name.startsWith('dsh-next-')).sort();
  assert.equal(plugins.length, 7);
  for (const form of [bugForm, standardForm]) {
    assert.deepEqual(form.body.find((field) => field.id === 'plugin').attributes.options.filter((name) => name.startsWith('dsh-next-')).sort(), plugins);
  }
});

function issueApi(failure) {
  const calls = [];
  const github = { rest: { issues: {} } };
  for (const method of ['createComment', 'update']) {
    github.rest.issues[method] = async (params) => {
      calls.push({ method, params });
      if (failure === method) throw new Error(`${method} failed`);
    };
  }
  return { github, calls };
}
const contextFor = (issue) => ({ repo: { owner: 'example-org', repo: 'plugins' }, payload: { issue } });

test('valid form, PR, or absent issue cause no GitHub writes', async () => {
  const api = issueApi();
  for (const issue of [formIssue(standardForm), formIssue(bugForm), { number: 42, pull_request: {} }, undefined]) {
    await enforceIssueTemplate({ github: api.github, context: contextFor(issue) });
  }
  assert.deepEqual(api.calls, []);
});

test('incomplete issue is explained before it is closed', async () => {
  const api = issueApi();
  await enforceIssueTemplate({ github: api.github, context: contextFor(formIssue(standardForm, { Summary: '' })) });
  assert.deepEqual(api.calls.map(({ method }) => method), ['createComment', 'update']);
  assert.match(api.calls[0].params.body, /Missing or blank required sections: Summary/);
  assert.match(api.calls[0].params.body, /Details \/ context/);
  assert.deepEqual(api.calls[1].params, { owner: 'example-org', repo: 'plugins', issue_number: 42, state: 'closed', state_reason: 'not_planned' });
});

test('invalid screenshot explanation has no spurious missing-section message', async () => {
  const api = issueApi();
  await enforceIssueTemplate({ github: api.github, context: contextFor(formIssue(bugForm, { 'Bug screenshot': 'Logs only.' })) });
  assert.match(api.calls[0].params.body, /Bug screenshot must include/);
  assert.doesNotMatch(api.calls[0].params.body, /Missing or blank/);
});

for (const failure of ['createComment', 'update']) {
  test(`enforcement propagates ${failure} failure and never closes after a failed comment`, async () => {
    const api = issueApi(failure);
    await assert.rejects(enforceIssueTemplate({ github: api.github, context: contextFor({ number: 42 }) }), new RegExp(`${failure} failed`));
    assert.equal(api.calls.length, failure === 'createComment' ? 1 : 2);
  });
}

test('workflow loads policy from an absolute trusted workspace module', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/issue-template-enforcer.yml', import.meta.url), 'utf8'));
  const [checkout, script] = workflow.jobs.enforce.steps;
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  assert.equal(script.uses, 'actions/github-script@v8');
  assert.match(script.with.script, /pathToFileURL\([\s\S]*process\.env\.GITHUB_WORKSPACE/);
  assert.doesNotMatch(script.with.script, /pull_request\.head|import\(['"]\.\//);
});
