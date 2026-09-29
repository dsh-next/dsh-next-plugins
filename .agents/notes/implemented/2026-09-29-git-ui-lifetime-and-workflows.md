# Make Git UI ownership and workflows explicit

- date: 2026-09-29
- status: implemented
- scope: packages/dsh-next-git

Acquire panel stores and publish tab actions only after a React commit, with matching cleanup; guard late startup and overlapping inventory reads. Keep keyboard navigation on the picker input and make clipboard success belong to the current patch. Separate repository branch confirmation from transfer preview and inventory, move tab seats and AI-control lifetime out of the client entry, and colocate diff, worktree, and commit styles without changing visual tokens. Regression suites cover abandoned renders, Strict Mode, late responses, keyboard Back, overlapping clipboard writes, and the platform's explicit clipboard refusal result. The named Git browser suite captures the reorganized views in light and dark themes. The package is private and needs no changeset. See the canonical rules in [package-structure.md](../../../docs/package-structure.md#browser-ui-composition).
