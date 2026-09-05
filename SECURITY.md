# Security

## Supported versions

| Version | Supported |
| ------- | --------- |
| 2.x     | Yes       |
| 1.x     | No        |

## Reporting a vulnerability

Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** on this
repository. Do not open a public issue for a security problem.

You will get an acknowledgement within 72 hours and a fix or a mitigation plan within 14 days
for a confirmed issue. Credit is given in the release notes unless you prefer otherwise.

## Scope

air has no runtime dependencies and no server-side component. Relevant reports are about the
library's own behavior: a request sent that the caller did not ask for, credentials reaching a
destination they should not, a header or body altered in a way the documentation does not
describe, or a hang or crash a caller cannot prevent. Behavior of the underlying `fetch` belongs
to the runtime that ships it.
