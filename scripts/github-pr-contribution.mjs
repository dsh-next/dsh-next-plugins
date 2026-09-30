/** Human PR evidence policy; bot release PRs remain exempt. */
export const LATEST_TARGET_CONFIRMATION = 'I have based this PR on the latest target branch (`main` or `dev`), or rebased / merged that branch before submitting.'
export const PR_TYPES = ['User-facing feature or behavior change', 'Bug fix', 'Visual fix (UI or visual issue)', 'Enhancement / optimization', 'Maintenance / refactor']

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }
function section(body, label) {
  const expression = new RegExp(`^##[ \\t]+${escapeRegExp(label)}[ \\t]*\\r?\\n([\\s\\S]*?)(?=^##[ \\t]+|(?![\\s\\S]))`, 'im')
  return body.match(expression)?.[1].replace(/<!--[\s\S]*?-->/g, '').trim() ?? ''
}
function blank(value) { return ['', 'no response', '_no response_'].includes(value.replace(/\s+/g, ' ').trim().toLowerCase()) }
function checked(value, label) { return new RegExp(`^-[ \\t]*\\[[xX]\\][ \\t]*${escapeRegExp(label)}[ \\t]*$`, 'm').test(value) }

export function validatePrContribution(pr) {
  if (pr?.user?.type === 'Bot' || pr?.user?.login === 'github-actions[bot]') return { exempt: true, errors: [] }
  const body = typeof pr?.body === 'string' ? pr.body : ''
  const errors = []
  if (!PR_TYPES.some(type => checked(section(body, 'PR Type'), type))) errors.push('Check at least one recognized item in `PR Type`.')
  if (!checked(section(body, 'Latest Codebase Confirmation'), LATEST_TARGET_CONFIRMATION)) {
    errors.push('Confirm `Latest Codebase Confirmation` against the latest PR target branch.')
  }
  const validation = section(body, 'Local Validation')
  const summary = /^Result summary:[ \t]*([\s\S]*)$/im.exec(validation)
  if (!summary || blank(summary[1]) || blank(validation.slice(0, summary.index))) {
    errors.push('Fill in `Local Validation` with commands (or why none ran) and a nonempty `Result summary`.')
  }
  return { exempt: false, errors }
}

export async function enforcePrContribution({ github, context, core }) {
  const pr = context.payload.pull_request
  if (!pr || pr.draft) return
  const result = validatePrContribution(pr)
  if (result.exempt || !result.errors.length) return
  if (context.payload.action !== 'synchronize') {
    try {
      await github.rest.issues.createComment({ ...context.repo, issue_number: pr.number, body: [
        'This PR is missing required contribution information.', '',
        'Update the PR description and keep the template complete:', '', ...result.errors.map(error => '- ' + error),
      ].join('\n') })
    } catch { core.warning('Unable to post the PR checklist comment; validation still fails.') }
  }
  core.setFailed(result.errors.join('\n'))
}
