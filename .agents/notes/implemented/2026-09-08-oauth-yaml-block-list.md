# Subscription settings.yaml uses block lists

Date: 2026-09-08
Status: implemented
Package: `@dsh-next/dsh-next-oauth-providers`

Empty `xai: {}` dumps as a YAML flow map, so later `models` stayed `{ }` / `[ ]`. Storage is now a provider list (`- id: xai`) with dashed model rows. Hydrate rewrites the old dict shape in one replace so the on-disk section is restyled.
