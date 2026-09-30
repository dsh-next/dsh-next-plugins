> Read [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md) before
> opening a PR. Commit messages use Conventional Commits (`type(scope): subject`)
> and never include emoji.

## Summary

<!-- One or two sentences on what changed and why. -->

## Affected Packages

<!-- Check the packages this PR touches. -->

- [ ] `packages/dsh-next-checkpoints`
- [ ] `packages/dsh-next-decisions`
- [ ] `packages/dsh-next-git`
- [ ] `packages/dsh-next-notifier`
- [ ] `packages/dsh-next-oauth-providers`
- [ ] `packages/dsh-next-opencode-session-patch`
- [ ] `packages/dsh-next-skills`
- [ ] Shared / scripts / docs

## PR Type

<!-- Check all that apply. -->

- [ ] User-facing feature or behavior change
- [ ] Bug fix
- [ ] Visual fix (UI or visual issue)
- [ ] Enhancement / optimization
- [ ] Maintenance / refactor

## Latest Codebase Confirmation

- [ ] I have based this PR on the latest target branch (`main` or `dev`), or rebased / merged that branch before submitting.

## Local Validation

<!-- Replace the sample with commands actually run. If none ran, explain why. -->

```bash
pnpm run ci
```

Result summary:

<!-- Note failures too. -->

## User-Visible Change Evidence

<!-- Required for user-facing changes. Attach screenshots or a short video
showing the change loaded from this PR, with the feature exercised. Internal
changes may state N/A. -->

## Repo Rules

- [ ] I have not modified DSH source; changes are based only on the official `@deepseek-ai/*` SDK.
- [ ] No tsconfig `extends` / `paths` / `references` points at a DSH source checkout.
- [ ] New packages are named `dsh-next-<slug>` under the `@dsh-next` scope.
- [ ] Source code, code comments, commit messages, and changeset entries follow the no-emoji rule in AGENTS.md.
- [ ] Repository documentation is English-only, package README pairs stay bilingual, and `pnpm docs:check` passes.
