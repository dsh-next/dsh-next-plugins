# Install reviewed OAuth plugin into web profile

- date: 2026-09-08
- status: implemented
- scope: local DSH web profile

At the user's request, rebuilt and packed `@dsh-next/dsh-next-oauth-providers`
and updated the existing `web` profile through `dsh plugin --profile web add`.
The persistent local tarball is
`artifacts/oauth-web/dsh-next-dsh-next-oauth-providers-0.1.0.tgz`; keep it available
for future profile dependency installs.

Verification: installation succeeded, composed configuration includes the OAuth
bundle, and installed host/client SHA-256 hashes match the rebuilt package.
Composition also reports an unrelated existing missing `dsh-next-cc-plugins`
patch target. The existing GUI at port 3080 still responds (HTTP 401 to an
unauthenticated request); authenticated rendering and activation of the updated
code were not verified. No host restart, replacement server, credential changes,
or live sign-in was performed. Restart the existing web host to ensure it loads
the updated build, then refresh and open Settings → Models → Subscriptions.

Prior implementation and test evidence:
[OAuth fixes](2026-09-08-oauth-review-fixes.md).
