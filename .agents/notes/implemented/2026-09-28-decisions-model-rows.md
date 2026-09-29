# Decision-specific model rows in the native Models style

- date: 2026-09-28
- status: implemented
- scope: packages/dsh-next-decisions

Replaced the Decisions editor's one-field model list with native-style expandable model rows. The canonical provider record now stores an exact model ID plus optional presentation name and provider-advertised input context; old `modelIds` arrays are read and migrate on a later user edit. Display labels do not alter model routing. Advertised context is informational because this System One adapter does not tokenize or enforce model-specific token limits.

The row shows Text/JSON and Choice as the currently supported input/output, with Image disabled; it does not copy chat-only `Max output tokens`. Independent decision models may support media through protocol extensions, but media input requires an explicit verified adapter rather than a UI claim. The technical contract and first-run wording belong in [decisions.md](../../../docs/decisions.md) and the [package guide](../../../packages/dsh-next-decisions/README.md).
