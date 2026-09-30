# Validate issue forms by issue type

- date: 2026-09-30
- status: implemented
- scope: .github/ISSUE_TEMPLATE and issue-template-enforcer

The [issue policy](<../../../scripts/github-issue-policy.mjs>) now requires the
actual form's detail heading: context for standard requests and reproduction
for bugs. A bug label or bug issue type still requires screenshot evidence.
Blank sections no longer consume the following heading and appear complete.

Both forms include all seven current plugins, independently of publication
status. [Fixture regressions](<../../../scripts/github-issue-policy.test.mjs>)
render the checked-in forms and cover required blanks, screenshots, issue
closing, and API failures without live GitHub writes. The
[workflow](<../../../.github/workflows/issue-template-enforcer.yml>) loads the
helper from an absolute trusted checkout path.

Validation: the four focused GitHub automation suites pass with Node 22 and
the root YAML dependency. No package, plugin, or unrelated workflow edits
belong to this change.
