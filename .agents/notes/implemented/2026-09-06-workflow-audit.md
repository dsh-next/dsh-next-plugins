# Workflow audit: bot checklist and issue-search quoting

- date: 2026-09-06
- status: implemented
- scope: .github/workflows

Exempt bot PRs from the contribution-template gate (Version Packages
would fail it). Quote the issue-dedup GitHub search so title punctuation
cannot be parsed as search operators.
