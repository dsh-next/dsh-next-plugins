> Read [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md) before
> opening a PR. Commit messages use Conventional Commits (`type(scope): subject`)
> and never include emoji.

## Summary

<!-- One or two sentences on what changed and why. -->

## Affected Packages

<!-- Check the packages this PR touches. -->

- [ ] `packages/dsh-next-notifier`
- [ ] `packages/dsh-next-cron`
- [ ] `packages/dsh-next-files`
- [ ] `packages/dsh-next-git`
- [ ] `packages/dsh-next-org`
- [ ] `packages/dsh-next-previews`
- [ ] `packages/dsh-next-slack`
- [ ] `packages/dsh-next-telegram`
- [ ] `packages/dsh-next-workflows`
- [ ] Shared / scripts / docs

## PR Type

<!-- Check all that apply. -->

- [ ] User-facing feature or behavior change
- [ ] Bug fix
- [ ] Visual fix (UI or visual issue)
- [ ] Enhancement / optimization
- [ ] Maintenance / refactor

## Latest Codebase Confirmation

- [ ] I have based this PR on the latest `main` branch, or rebased / merged latest `main` before submitting.

## Local Validation

<!-- Commands executed and the result summary. Do not leave blank. -->

```bash
pnpm typecheck
pnpm test
pnpm build
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
- [ ] No file contains emoji.
- [ ] Documentation is English-only and `pnpm docs:check` passes.
