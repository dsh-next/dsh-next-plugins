# Agent Notes

Agent Notes are short-lived records of non-trivial changes, decisions, and
follow-ups, written by the agent in the same change that produced them.

## Lifecycle

Notes move between directories as their status changes:

- `proposed/` — a plan or decision awaiting confirmation.
- `implemented/` — a change that has landed.
- `rejected/` — a proposal that was declined.
- `archived/` — an implemented or rejected note superseded by later work.

## Format

```markdown
# <title>

- date: YYYY-MM-DD
- status: proposed | implemented | rejected | archived
- scope: <package or area, e.g. packages/dsh-next-skills>

<summary of the change or decision, with the facts that matter>
```

## Rules

- Write one note per non-trivial change, in English, without emoji.
- Keep each fact in its owning document; a note links rather than duplicates.
- Archive a note when a later change supersedes it.
