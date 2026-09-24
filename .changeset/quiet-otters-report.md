---
"@dsh-next/dsh-next-skills": patch
---

The Skills panel now reports a failed host request with a readable message, such
as `Skills request "getState" failed (HTTP 405)`, instead of showing the
browser's raw JSON parser error when the response carried no JSON body.
