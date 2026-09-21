# Show history command errors directly

- date: 2026-09-20
- status: implemented
- scope: packages/dsh-next-git

History command errors now show the full detail immediately in an error-colored,
1px bordered section with 12px padding. Removed both Retry controls and their
unused retry state from the command modal; status checks and conflict recovery
remain available. Execution/status errors use the same presentation. This
supersedes the collapsed-error behavior in the simple-history-modals note.

Updated the bilingual README pair and regression assertions. The 25 command and
commit-details tests, plugin build (including TypeScript), documentation check
and whitespace check pass. Mounted browser verification remains unavailable
without the GUI authentication URL; this change does not restart the user host.
