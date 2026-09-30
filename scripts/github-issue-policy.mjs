/** @typedef {{ number: number, body?: string | null, labels?: Array<string | {name?: string}>, pull_request?: object }} Issue */

const commonSections = ['Affected plugin', 'Issue type', 'Summary', 'Expected outcome'];

function readSection(body, label) {
  const heading = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^###[ \\t]+${heading}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^###[ \\t]+|(?![\\s\\S]))`, 'im');
  const match = body.match(pattern);
  return match ? match[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
}

function isBlank(value) {
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
  return ['', 'no response', '_no response_'].includes(normalized);
}

function hasScreenshotEvidence(value) {
  return /!\[[^\]]*]\([^)]+\)/i.test(value)
    || /https?:\/\/\S*(?:github\.com\/user-attachments\/assets\/|github\.com\/[^)\s]+\/assets\/|githubusercontent\.com\/|[./][^)\s]+\.(?:png|jpe?g|gif|webp))(?:[?#]\S*)?/i.test(value);
}

/**
 * Validate the headings emitted by the two checked-in GitHub issue forms.
 * @param {Issue} issue
 * @returns {{valid: boolean, requiredSections: string[], missingSections: string[], invalidSections: string[]}}
 */
export function validateIssue(issue) {
  const body = issue.body || '';
  const issueType = readSection(body, 'Issue type').toLowerCase();
  const hasBugLabel = (issue.labels || []).some((label) =>
    (typeof label === 'string' ? label : label.name || '').toLowerCase() === 'bug');
  const isBug = issueType === 'bug report' || hasBugLabel;
  const requiredSections = [
    ...commonSections,
    isBug ? 'Details / reproduction' : 'Details / context',
    'Environment',
    ...(isBug ? ['Bug screenshot'] : []),
  ];
  const missingSections = requiredSections.filter((label) => isBlank(readSection(body, label)));
  const invalidSections = [];
  const screenshot = readSection(body, 'Bug screenshot');
  if (isBug && !isBlank(screenshot) && !hasScreenshotEvidence(screenshot)) {
    invalidSections.push('Bug screenshot must include an uploaded image, Markdown image, or image link.');
  }
  return { valid: missingSections.length === 0 && invalidSections.length === 0, requiredSections, missingSections, invalidSections };
}

/**
 * Validate before writing; API failures propagate instead of reporting a successful enforcement.
 * @param {object} options
 * @param {{repo: {owner: string, repo: string}, payload: {issue?: Issue}}} options.context
 * @param {{rest: {issues: {createComment: Function, update: Function}}}} options.github
 */
export async function enforceIssueTemplate({ github, context }) {
  const issue = context.payload.issue;
  if (!issue || issue.pull_request) return;
  const result = validateIssue(issue);
  if (result.valid) return;
  const comment = [
    'This issue was auto-closed because it did not use the required issue template.',
    '',
    'Please re-open using an issue form and fill in all required sections:',
    '',
    ...result.requiredSections.map((label) => `- ${label}`),
    '',
    ...(result.missingSections.length ? ['Missing or blank required sections: ' + result.missingSections.join(', ')] : []),
    ...result.invalidSections,
  ].join('\n');
  const target = { ...context.repo, issue_number: issue.number };
  await github.rest.issues.createComment({ ...target, body: comment });
  await github.rest.issues.update({ ...target, state: 'closed', state_reason: 'not_planned' });
}
