# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 1.x     | Yes       |
| < 1.0   | No        |

## Reporting a vulnerability

**Please do not open a public issue.**

Use the [Report a vulnerability][advisories] button on this repository's
Security tab, which opens a private thread, or email <security@crmleaf.app> with
"SECURITY" in the subject.

Please include the version affected, the impact, and steps to reproduce.

### What to expect

- **Acknowledgement** within 3 business days.
- **Severity assessment** within 10 business days.
- **Coordinated disclosure**, 90 days by default, sooner if a fix ships sooner.

Reporters are credited in the advisory unless they ask not to be.

## A wrong figure is not a vulnerability

An incorrect statutory calculation is a bug, and a serious one, but it is not a
security issue. Report it as a normal issue so it can be discussed in the open,
with the citation that turns it into a test case.

## Scope

In scope: this package, and the rate tables it embeds from `crmleaf/payroll-core`.

Out of scope: the hosted tools at <https://www.indpayroll.com/free-tools>, and
third-party dependencies. Report those upstream, and tell us so we can pin or
patch.

[advisories]: https://github.com/crmleaf/payroll-js/security/advisories/new
