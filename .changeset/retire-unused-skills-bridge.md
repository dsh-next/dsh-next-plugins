---
"@dsh-next/dsh-next-skills": minor
---

**Breaking:** Removed the `cc-external-skills` service and its exported integration interface. Plugins that used this service must stop calling it. Existing skill files and ownership safeguards are preserved; ordinary skill browsing, installation, and updates remain available.
