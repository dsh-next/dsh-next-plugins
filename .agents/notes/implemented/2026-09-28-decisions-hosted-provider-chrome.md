# Hosted decision providers in the native Models chrome

- date: 2026-09-28
- status: implemented
- scope: packages/dsh-next-decisions

Refined the private Decisions plugin's supported Models footer seat with compact native-style provider cards, inline editing and removal, a disclosure for manually configured model IDs and sample testing, and a hosted-only TypeSafe/custom add choice. The TypeSafe preset fixes its endpoint through later edits and requires a key at creation; the custom choice keeps an editable compatible endpoint. Switching between add choices preserves each draft through the SDK's own keyboard-accessible segmented control, while the provider catalog and credentials retain their separate Host ownership. Saved card actions use provider-qualified accessible names without changing their native-style visible labels. A credential indicator never claims that a model answered. Dedicated local-model provisioning and a local/hosted runtime mode remain outside this change.

The [decision contract](../../../docs/decisions.md) owns the integration limits, and the [first-run guide](../../../packages/dsh-next-decisions/README.md) owns click instructions and screenshots. Preserve the earlier [explicit-provider note](2026-09-28-decisions-explicit-model-providers.md) for the initial implementation and its test evidence.
