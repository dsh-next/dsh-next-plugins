# Separate family mount smoke from plugin behavior suites

- date: 2026-09-20
- status: implemented
- scope: tests/e2e, scripts/workflow, contributor testing guidance

The [suite registry](/Users/rokgrabnar/Projects/dsh-next-plugins/scripts/workflow.mjs) keeps family composition and short UI mounts in `smoke`, with independently selectable Git, Skills, Claude Plugins, Notifier, OAuth Providers, Reset, and existing Checkpoints behavior suites. The [contributor guide](/Users/rokgrabnar/Projects/dsh-next-plugins/CONTRIBUTING.md#L62) owns their commands and responsibilities.

The runner still packs the combined dependency closure once for `all`, starts a fresh owned runtime per suite attempt, preserves required peers for focused selection, and keeps live-model testing separate. Plugin scenarios no longer depend on the family smoke's mutations. Skills setup leaves a correct adversarial seed untouched, repairs only a missing/detached seed through RPC, and identifies the catalog test's session from its own submitted prompt rather than another marker's registry state.

The shared browser fixture checks page errors, plugin console errors (including secondary tabs), and crash markers after each extracted test, even on failure, then removes its listeners. Family clients must have a UI mount marker or an explicit non-UI reason. Existing long-form assertions were extracted from the dirty working-tree mount spec, preserving the ongoing Git implementation's behavior checks.

Runtime pins, plugin implementation, model replay, test coverage policy, and package versions are unchanged. Validation results are recorded in the completion handoff; unrelated baseline failures are not corrected or bypassed by this split.
