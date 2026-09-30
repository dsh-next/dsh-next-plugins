# Fail closed when Agent Notes file retrieval fails

- date: 2026-09-30
- status: implemented
- scope: .github/workflows/agent-notes-guard.yml

The [guard](<../../../.github/workflows/agent-notes-guard.yml>) checks a successful
paginated PR-file retrieval before filtering protected paths. API failures,
including failures after partial output, cannot masquerade as an untouched
Agent Notes tree. The workflow explicitly grants PR-read permission and keeps
the existing same-repository and OWNER/COLLABORATOR/MEMBER allowances.
Previous filenames are included so renaming notes out of the tree stays
protected. Slurped JSON objects are validated and counted against the expected
PR file count before path filtering. Missing/malformed counts, malformed or
short listings, and PRs above the API's 3,000-file limit fail closed too.

[Regression tests](<../../../scripts/github-agent-notes-guard.test.mjs>) execute
the actual workflow shell with a mocked gh executable: no notes, later-page
notes, fork contributor rejection, allowed associations, same-repository
allowance, renames, and retrieval failures all have coverage. No GitHub writes
or real credentials are used. All four focused GitHub automation suites pass.
