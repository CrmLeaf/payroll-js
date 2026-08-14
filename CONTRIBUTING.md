# Contributing to @crmleaf/payroll-js

Thanks for taking the time. This package is the TypeScript port of the CRMLeaf
payroll engine: the same statutory calculations, running in a browser with no
server.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Where to open things

Open issues and pull requests **here**, against this repository. It holds its
own history and tags.

## The one rule that shapes everything

**This package must agree with [`crmleaf/payroll-core`][core] to the paisa.**

Two implementations of the same statute is two chances to get it wrong, and the
disagreement surfaces months later on somebody's payslip as a rupee that will
not reconcile. So the agreement is tested, not intended:

- `src/rates/tables.ts` is **generated verbatim** from that package's JSON and
  committed here, so a JavaScript consumer needs no PHP. Never hand-edit it. A
  rate change starts in `payroll-core`, and this file is regenerated from it.
- `test/fixtures/parity.json` is generated **from `payroll-core` itself** and
  pins the numeric agreement. Never hand-edit that either; regenerate it. A
  fixture edited to match a changed port is a test that has stopped testing.

A calculation fix therefore lands in `payroll-core` first. Porting it here
without that is how the two drift.

[core]: https://github.com/crmleaf/payroll-core

## Reproducing locally

Node 20 or newer. There are no runtime dependencies.

```bash
git clone https://github.com/crmleaf/payroll-js.git
cd payroll-js
npm install
npm run build      # required before the suite: see below
npm test
npm run typecheck
```

**Build before testing.** Several tests load `dist/payroll.min.js` and render a
real page against it — the browser bundle, the embed example, the web
components. They skip silently when `dist/` is absent, so a suite run on a clean
checkout will look green while never having exercised any of it.

Two test files read the monorepo's generated `tools/` directory and skip here.
That is expected: they cover packages this repository does not ship.

## Pull requests

- **Branch from `main`.** Name it `feat/…`, `fix/…`, `docs/…` or `chore/…`.
- **One logical change per pull request.**
- **Write a test.** A bug fix needs one that fails before the fix.
- **Update `CHANGELOG.md`** under `## [Unreleased]`.
- **Mind the public API.** A changed export, subpath or component attribute is
  breaking. New calculators are additive; renamed ones are not.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org):

```
fix(esi): round the employee share up to the rupee, not to the nearest
feat(elements): add a compliance-calendar element
docs(embed): show the script-tag route without a bundler
```

## Reporting a wrong figure

If a calculation is wrong, it is almost certainly wrong in both languages, so
open it against [`crmleaf/payroll-core`][core] with the inputs, the figure you
got, the figure you expected, and the rule that says so.

Open it **here** when the two disagree — that is a parity bug, and it is this
repository's problem.

## Security

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## Licence

Contributions are accepted under the [MIT Licence](LICENSE). You confirm you
have the right to submit the code under that licence.
