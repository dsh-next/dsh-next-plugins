# Documentation rules

This file governs the documentation in this repository.

## Conventions

- Documentation is written in English only. Package READMEs are the one
  exception: they are maintained as bilingual English/Chinese pairs under the
  contract in `docs/i18n.md`.
- Keep each fact in its owning document; do not duplicate facts across files.
- Update documentation in the same change that changes behavior.
- Put temporary handoffs, decisions, and validation snapshots in
  `docs/archive/`.

## Required files

- Every package has a bilingual README pair (`README.md`, `README.zh.md`, and
  the `README.i18n.yaml` pairing record) describing its purpose, install, and
  development commands; the pairing contract lives in `docs/i18n.md`.
- Repository-level rules live in `AGENTS.md`; contributor guidance in
  `CONTRIBUTING.md`.

## Validation

Run `pnpm docs:check` before merging to verify the documentation contract.
