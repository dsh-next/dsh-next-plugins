# Own the skills grid model beside its view

- date: 2026-09-29
- status: implemented
- scope: packages/dsh-next-skills

Moved installed/candidate grid composition and relevance filtering out of the settings panel into a feature-owned grid module. The skill detail dialog's markup now lives beside that feature, while its RPC loading and dismissal state remain with the panel. The existing panel exports remain available to callers; rendered cards, filters, markup, keyboard controls, and errors retain their behavior. Removed an unused temporary set from the grid calculation. The package already has a pending changeset; this move adds no user-visible behavior.
