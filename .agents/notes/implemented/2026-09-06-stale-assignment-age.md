# Stale PR reassignment used "no comment in 14 days", not assignment age

- date: 2026-09-06
- status: implemented
- scope: .github/workflows/stale-assignment.yml

A 6-hour-old PR assigned to sitegroove was reassigned because the
assignee had not commented yet. The sweep now skips until the assignment
(or PR created_at) is older than 14 days.
