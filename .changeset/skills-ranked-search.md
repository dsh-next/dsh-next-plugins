---
"@dsh-next/dsh-next-skills": patch
---

Rank Skills search results by relevance: exact name matches come first, then
name prefixes, then names containing the query, and only afterwards skills
whose description or provider merely mentions it. Previously every substring
hit ranked equally in alphabetical order, so searching a skill's name could
bury it behind unrelated description matches. Changing the search also
returns to the first page instead of keeping a deep-scrolled page size.
