# Automations plugin product and reuse proposal

- date: 2026-09-09
- status: proposed
- scope: proposed packages/dsh-next-automations

Captured the requested stock-Harness audit, automation-tool inspiration, product
options, staged scope and execution/evaluation design in the
[automations proposal](../../../docs/archive/2026-09-09-automations-proposal.md).
That document owns the findings, source evidence and decisions awaiting confirmation.

This is a research-only change. No package was scaffolded, no runtime behavior or
GUI was changed, and no DSH checkout/distribution or existing user changes were
modified. Implementation starts after the first process, deployment and permitted
actions are agreed; source inspection is not runtime durability validation.

Validation: `pnpm docs:check` passed for all seven existing README pairs. This
gate checks the repository documentation contract, not the proposed execution
guarantees; runtime, model, integration and browser tests are intentionally deferred
until implementation. A fresh-reader review identified reconciliation-window and
approval-consumption ambiguities; the proposal now states their recovery rules
and required failure cases explicitly.
