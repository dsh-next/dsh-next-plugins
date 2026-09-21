# Inline Git message drafting and model preference

- date: 2026-09-21
- status: implemented
- scope: packages/dsh-next-git

The Commit, Squash and Reword sparkle buttons now make one bounded text-only
model request and replace both existing message fields directly. They no longer
open an agent destination dialog or require a separate Use message step. Failure,
cancellation, a changed editor scope, or unmount never replaces the fields.
Ordinary agent review/explain/resolve workflows remain separate.

Git's bundle configuration on the Plugins page offers a drafting model selector.
The live settings namespace is `dsh-next-git`; `draftingProvider` and
`draftingModel` are saved as a pair. Empty values follow the exact source
session's pending selection, then its last request model, then the deployment
default. This does not mutate chat model selection. The host reads official SDK
session projections; a redundant browser model resolver was removed.

The current SDK requires `plugins.bundle.config`, keyed by the npm package name.
The old `settings.plugin.item` example typechecks elsewhere but is not rendered
on the current Plugins page. Browser verification caught and corrected this.
The shell owns the title/navigation; our body contains only the model field.

Host generation is read-only, tool-free, scoped by the authorized session's
checkout, limited to 64k evidence, 16k previous text and 16k output, with a 2048
output-token cap and 60-second deadline. At most one call per session and four
calls total run concurrently. Incomplete/error/tool-call output is refused.
Request disconnect and plugin disposal cancel generation; uncooperative provider
iterators cannot hold the RPC open indefinitely. History evidence is drawn from
selected reachable commits; staged drafting does not read unstaged file content.

Validation: Git typecheck, complete Git unit suite (1609 passed, one existing
skip before final extra coverage), focused drafting/settings/entry tests, docs,
i18n, runtime dependencies and whitespace checks. Direct RPC disconnect tests
cover both request-aborted and response-close cleanup. Browser tests use fixed
model output for editor replacement (no paid provider calls), real Git mutations
for the existing suite, and real settings/catalog RPCs for the new bundle form.
Repository-wide typecheck remains blocked by the existing cc-plugins LLM SDK
MessageId version conflict, unrelated to this change.

The final isolated Git browser suite passed in `artifacts/testing/run-OHrQul`;
it includes direct Commit/Squash replacement screenshots and the live settings
catalog form. The model settings screenshot is stored in the package media
folder and shown in both READMEs. The tested package was installed into the
existing `web` profile without restarting its DSH process. No real model call
was made against the user's credentials.
