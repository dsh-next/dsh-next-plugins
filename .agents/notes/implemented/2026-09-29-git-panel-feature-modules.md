# Organize Git panel by feature

- date: 2026-09-29
- status: implemented
- scope: packages/dsh-next-git

Split the large Git panel render file into feature-owned Changes and Worktrees views, commit and stash controls, and focused panel chrome, diff, title, and registry modules. The shared accordion now serves all three sections; translation and failure labels no longer depend on the panel coordinator. Existing panel exports remain available for callers. The refactor preserves UI copy, styles, data markers, actions, and error handling; added coverage for extracted failure helpers, path labels, and store ownership. The plugin remains private, so it does not need a changeset.
