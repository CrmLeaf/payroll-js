# Changelog

Notable changes to `@crmleaf/payroll-js`.

Format per [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning
per [Semantic Versioning](https://semver.org/spec/v2.0.0.html), with one extra
rule this package observes because it computes statutory figures:

> **Any change that alters a published result is at minimum a minor release**,
> and is listed under `Changed` with the notification, circular or Act section
> that prompted it.

This package is a port. It must agree with `crmleaf/payroll-core` to the paisa,
and `test/fixtures/parity.json` — generated from that package, never written by
hand — is what holds it to that.

## [Unreleased]

## [1.0.0] - 2026-08-14

### Added

- TypeScript ports of the twelve backend-free calculators: provident fund, state
  insurance, income tax, tax deducted at source, professional tax, gratuity,
  bonus, leave encashment, cost to company, full and final settlement, provident
  fund penalties and the compliance calendar, plus salary templates, payslips
  and GST invoices.
- `Money` as an integer of paise with Indian digit grouping, matching the PHP
  implementation's three statutory rounding modes.
- The statutory rate tables, embedded verbatim from `crmleaf/payroll-core` and
  committed, so nothing here needs PHP at build or run time.
- Embeddable web components — a calculator in a page with no framework and no
  build step.
- A tree-shakeable ESM build, per-calculator subpath exports, and a single-file
  UMD bundle for a plain `<script>` tag.
- No runtime dependencies.

### Statutory basis

Identical to `crmleaf/payroll-core` v1.0.0, and pinned to it by
`test/fixtures/parity.json`.

[Unreleased]: https://github.com/crmleaf/payroll-js/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/crmleaf/payroll-js/releases/tag/v1.0.0
