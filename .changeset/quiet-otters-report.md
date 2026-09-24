---
"@dsh-next/dsh-next-skills": patch
---

The Skills panel now reports a failed host request with a readable message, such
as `Skills request "getState" failed (HTTP 405)`, instead of showing the
browser's raw JSON parser error when the response carried no JSON body. A
response whose body parses but is not a skills payload is reported the same way
rather than leaving the page blank.
