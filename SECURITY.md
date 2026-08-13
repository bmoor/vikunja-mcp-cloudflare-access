# Security policy

Please do not include API tokens, Cloudflare Access assertions, account data, or task content in public issues.

For a suspected vulnerability, use GitHub's private vulnerability reporting for this repository when available. If it is unavailable, contact the repository owner privately before opening an issue.

The intended deployment boundary is:

- Cloudflare Access at the public edge;
- full origin validation of the Cf-Access-Jwt-Assertion header;
- a separate least-privilege Vikunja integration token stored only as a runtime secret;
- writes disabled unless both the feature flag and the authenticated identity allow them.

## Public repository boundary

This repository contains reusable adapter code and generic deployment examples
only. Do not commit private host labels, private domains, private network
addresses, local filesystem paths, deployment-account details, real user email
addresses, task data, or runtime configuration values.

Run `npm run setup:public-git` once after cloning. It enables the tracked
pre-push hook for this checkout and configures a non-personal commit identity.
`npm run check:public-boundary` is also enforced by CI. Keep private deployment
configuration and operating documentation in the appropriate private system.
