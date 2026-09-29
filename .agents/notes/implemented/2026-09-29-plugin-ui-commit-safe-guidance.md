# Document commit-safe plugin UI ownership

- date: 2026-09-29
- status: implemented
- scope: docs/package-structure.md and .agents/skills

Extended the canonical [browser UI composition guidance](../../../docs/package-structure.md#browser-ui-composition) with commit-safe shared-store and ref ownership, asynchronous response freshness, and keyboard scope. The coding, design, and code-review skills point implementers toward meaningful workflow seams and require targeted tests and light/dark screenshot comparisons when CSS is moved. These checks follow the Git UI lifecycle corrections; this guidance does not add a new shared package.
