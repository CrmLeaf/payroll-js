# @crmleaf/payroll-js

Indian payroll calculations that show their working - in the browser, in Node, or
dropped into a static HTML file with one script tag.

This is the JavaScript counterpart to [`crmleaf/payroll-core`](https://github.com/crmleaf/payroll-core).
Both read the **same** statutory rate tables, both do their arithmetic in integer
paise, and both return the same result shape, so a figure computed in a visitor's
browser and one computed on your PHP server agree to the paisa. A CI job fails the
build if they ever drift.

```
npm install @crmleaf/payroll-js
```

> [!NOTE]
> Not on npm yet. Until it is, **Mode B** below needs no registry and works
> today: build the single-file bundle once and serve it yourself. Installing
> straight from git will not work either, because the published tarball is built
> at pack time and the repository does not carry `dist/`.

Fifteen tools, none of which need a backend:

| Tool | Import | Element |
| --- | --- | --- |
| CTC breakdown | `@crmleaf/payroll-js/ctc` | `<payroll-ctc-calculator>` |
| Monthly TDS under section 192 | `@crmleaf/payroll-js/tds` | `<payroll-tds-calculator>` |
| EPF, EPS, EDLI | `@crmleaf/payroll-js/pf` | `<payroll-pf-calculator>` |
| ESI | `@crmleaf/payroll-js/esi` | `<payroll-esi-calculator>` |
| Gratuity | `@crmleaf/payroll-js/gratuity` | `<payroll-gratuity-calculator>` |
| Statutory bonus | `@crmleaf/payroll-js/bonus` | `<payroll-bonus-calculator>` |
| Leave encashment | `@crmleaf/payroll-js/leave-encashment` | `<payroll-leave-encashment-calculator>` |
| Full and final settlement | `@crmleaf/payroll-js/fnf` | `<payroll-fnf-calculator>` |
| EPFO interest and damages | `@crmleaf/payroll-js/epfo-penalty` | `<payroll-epfo-penalty-calculator>` |
| Compliance calendar | `@crmleaf/payroll-js/compliance-calendar` | `<payroll-compliance-calendar>` |
| Payroll ROI | `@crmleaf/payroll-js/roi` | `<payroll-roi-calculator>` |
| Provider savings | `@crmleaf/payroll-js/savings` | `<payroll-savings-calculator>` |
| Payslip for one wage month | `@crmleaf/payroll-js/payslip` | `<payroll-payslip-generator>` |
| GST tax invoice | `@crmleaf/payroll-js/invoice` | `<payroll-invoice-generator>` |
| Salary spreadsheet templates | `@crmleaf/payroll-js/salary-templates` | `<payroll-salary-templates>` |

Income tax and professional tax are exported too (`/income-tax`,
`/professional-tax`); the CTC, F&F and payslip calculators compose them
internally.

The last three produce a *document* rather than a figure - a wage slip itemised
the way section 13A requires, a tax invoice with the tax head the place of supply
demands, and the four payroll spreadsheets as column schemas with worked sample
rows. None of them render a file: turning a schema into a PDF or an XLSX is the
host application's job.

---

## Mode A - install it from npm

Named exports, full types, tree-shakeable. `sideEffects` is declared, so a bundler
drops every calculator the page never calls.

```js
import { calculateGratuity } from '@crmleaf/payroll-js';

const result = calculateGratuity({
  lastDrawnSalary: 45000,
  yearsOfService: 7,
  monthsOfService: 7,   // more than six months rounds the year up
});

result.gratuity.format();   // '₹2,07,692.31'
result.explain();           // '(15 × 45,000.00 × 8) ÷ 26 = ₹2,07,692.31'
result.taxExempt.toRupees();
result.citations;           // ['Payment of Gratuity Act, 1972 - …']
```

Pull in one calculator and nothing else:

```js
import { calculateGratuity } from '@crmleaf/payroll-js/gratuity';
import { calculatePf }       from '@crmleaf/payroll-js/pf';
```

CommonJS works too:

```js
const { calculateEsi } = require('@crmleaf/payroll-js');
```

### Every result has the same shape

```ts
interface Result {
  amount: Money;                 // the headline figure
  workings: readonly Step[];     // the ordered working
  citations: readonly string[];  // the statutes it rests on
  explain(): string;             // the formula with real operands substituted
  toArray(): Record<string, unknown>;  // snake_case, JSON-safe - identical to PHP
}
```

`JSON.stringify(result)` gives you `toArray()` plus `explanation`, `steps` and
`citations` - byte-comparable with what the PHP package serialises, which is what
makes the two interchangeable across the wire.

### Money is integer paise, never a float

```js
import { Money } from '@crmleaf/payroll-js';

Money.fromRupees(15000).percentage(8.33).paise;  // 124950, exactly
Money.fromRupees(1234567.89).format();           // '₹12,34,567.89' - Indian grouping
```

Payroll is full of thirds and sevenths: gratuity divides by 26, EPS is 8.33%, a
monthly TDS instalment is an annual figure over twelve. Floats accumulate error
that eventually surfaces as a one-rupee mismatch on an ECR challan, so every
amount here is an integer of paise and every division rounds explicitly - halves
away from zero, the way PHP's `round()` does.

### Dates select the rates

Nothing here is "the current rate". Everything is "the rate on this date", because
payroll routinely recomputes the past: a revised F&F six months after separation,
an arrear paid in a later year, an audit of last year's challans.

```js
calculatePf({ basicSalary: 30000, asOf: '2013-06-01' }).wageCeiling.toRupees();
// 6500 - the ceiling before S.O. 2882(E) raised it in September 2014

calculateEsi({ grossWages: 18000, asOf: '2018-06-01' }).employeeRate;
// 1.75 - the rate before G.S.R. 423(E) cut it in July 2019
```

`asOf` accepts a `Date`, a `YYYY-MM-DD` string, or a financial-year label such as
`'2025-26'`.

### Statutory ineligibility is not an error

Three years of service is a valid answer of nil gratuity, with a reason. A
negative salary is a bug in your code and throws `InvalidInputError`.

```js
const result = calculateGratuity({ lastDrawnSalary: 45000, yearsOfService: 3 });

result.eligible;              // false
result.gratuity.isZero();     // true
result.ineligibilityReason;   // 'Gratuity needs 5 years of continuous service. …'
```

---

## Mode B - one script tag, no build step

A single self-contained file. No dependencies, no module loader, no bundler.

```html
<script src="/js/payroll.min.js"></script>
<script>
  const result = Payroll.calculateTds({ monthlyGross: 106250, asOf: '2025-06-01' });
  document.querySelector('#tds').textContent = result.monthlyTds.format();
</script>
```

Everything the module build exports is on the global `Payroll` - the calculators,
`Money`, the rate repository, the elements. The file also assigns to
`module.exports` when a CommonJS-style loader is present, so it survives the
sandboxes some CMS plugins run scripts in.

`dist/payroll.js` is the same bundle unminified, for when you want to read it.

---

## Mode C - web components, zero JavaScript written by you

Load the bundle and write a tag. That is the whole integration.

```html
<script src="/js/payroll.min.js"></script>

<payroll-gratuity-calculator></payroll-gratuity-calculator>
```

Or, for editors that strip unknown tags out of the WYSIWYG:

```html
<div data-payroll="pf-calculator"></div>
```

The script registers every element and upgrades every `data-payroll` placeholder
as soon as the document is ready.

**[`examples/embed.html`](examples/embed.html) is a real, openable page that
demonstrates all of this.** Build the package and open the file - no server
required.

### Seeding the fields

Any field can be set from an attribute, named in kebab-case:

```html
<payroll-pf-calculator
  basic-salary="52000"
  employer-restricts-to-ceiling="false"></payroll-pf-calculator>

<payroll-gratuity-calculator
  last-drawn-salary="60000"
  years-of-service="10"
  separation-reason="retirement"></payroll-gratuity-calculator>
```

Other attributes: `heading` overrides the title, `theme="dark"` or `theme="light"`
pins the colour scheme, `hide-tagline` and `hide-workings` trim the chrome, and
`<payroll-tool tool="esi-calculator">` is the generic form.

### Theming

Each widget renders into a shadow root, so your stylesheet cannot reach inside it
and its styles cannot leak onto your page. Custom properties are the supported
seam - they cross the shadow boundary, ordinary selectors do not.

```css
payroll-gratuity-calculator {
  --payroll-accent: #7a3ea8;
  --payroll-fg: #1d242c;
  --payroll-bg: #ffffff;
  --payroll-surface: #f5f0fa;
  --payroll-border: #ddd0ea;
  --payroll-muted: #6b7683;
  --payroll-font: "Inter", system-ui, sans-serif;
  --payroll-mono: "IBM Plex Mono", monospace;
  --payroll-radius: 2px;
  --payroll-gap: 1rem;
  --payroll-font-size: 15px;
}
```

They inherit, so setting them on a wrapper - or on `:root` - themes every widget
inside it. Without any of that, the widgets follow `prefers-color-scheme`.

### Accessibility

Every control is a real `<input>` or `<select>` with a `<label for="…">`; hints are
tied on with `aria-describedby`; the results region is `role="status"` with
`aria-live="polite"`, so a screen reader announces the new figure as it changes;
focus rings are never removed; and the whole thing is operable from the keyboard,
with a submit button for anyone who expects one. Nothing is assembled from a value
with `innerHTML`, so an attribute carrying user input cannot become script.

### Reacting to a widget

```js
document.querySelector('payroll-ctc-calculator')
  .addEventListener('payroll:result', (event) => {
    const { tool, values, result } = event.detail;
    console.log(tool, result.headline.value, result.workings.length);
  });
```

`payroll:error` fires instead when the inputs cannot be computed. Both bubble and
cross the shadow boundary. The element also exposes `.values` and `.run()`.

### Building your own UI

The form definitions the widgets are generated from are exported, so you can drive
your own markup from the same source:

```js
import { TOOLS, findTool } from '@crmleaf/payroll-js';

const gratuity = findTool('gratuity');
gratuity.fields;                       // [{ name, label, type, default, … }]
gratuity.run({ lastDrawnSalary: 45000, yearsOfService: 8 });
```

---

> **On CDNs.** A hosted build served by `unpkg` and `jsDelivr` is coming soon,
> at which point the script tag becomes a single URL with nothing to host. The
> examples above serve the file themselves, which works today, keeps working
> afterwards, and is the only option that makes no third-party request.

## Rate parity with the PHP engine

The numbers live in exactly one place: `packages/payroll-core/resources/rates/*.json`,
all amounts in **paise**. `scripts/generate-rates.mjs` embeds that JSON verbatim
into `src/rates/tables.ts` with a SHA-256 of the source in the header. Nothing is
retyped, so the two languages cannot disagree about a slab.

```
npm run rates:generate    # also runs automatically before every build
```

`bin/check-rate-parity.php` compares the two in CI and fails the build on any
drift. `RATES_CHECKSUM` is exported if you want to assert it yourself.

Parity is tested, not merely intended. `test/fixtures/parity.json` is generated by
running `crmleaf/payroll-core` itself over 68 cases - the EPS ₹1,250 cap, the ESI
per-share round-up, the gratuity six-month boundary at 7y6m and 7y7m, the 87A
marginal relief band, historical rate versions back to 2001 - and the Vitest suite
replays every one of them through the TypeScript engine, asserting the complete
`toArray()`, the explanation and the citations match exactly.

```
docker run --rm -v "$PWD:/app" -w /app payroll-php:8.3 \
  php packages/payroll-js/scripts/generate-parity-fixture.php
```

---

## The rules that are easy to get wrong

Each of these has a test and a citation behind it.

- **EPS is capped, EPF is not.** An employer contributing 12% on a ₹30,000 basic
  still remits only ₹1,250 to the Pension Fund, not 8.33% of ₹30,000. The EPF side
  is a remainder, so the employer parts with the full 12% either way.
- **ESI rounds each share up separately.** Rule 51 rounds the employee's 0.75% and
  the employer's 3.25% up to the rupee individually. Rounding the combined 4%
  loses a rupee on most wages and will not reconcile against the challan.
- **Gratuity rounds up above six months, not at it.** Seven years and six months is
  seven years; seven years and seven months is eight. Establishments outside the
  Act divide by 30 and do not round at all.
- **The 87A marginal relief band.** At ₹12,10,000 of income the slabs give ₹61,500,
  but only ₹10,000 is payable - the whole of the income above the threshold. Relief
  is computed before cess, and cess then applies to the reduced figure.
- **Bonus has two different wage figures.** ₹21,000 decides eligibility; ₹7,000 (or
  the notified minimum wage, if higher) decides what the bonus is computed on.
- **ESI's contribution-period rule.** Contributions that begin in a period run to
  the end of it, so a mid-period rise above ₹21,000 does not end coverage until the
  next period starts.
- **F&F counts the last working day.** Joining 1 January 2020 and working to 31
  December 2024 is five years of service. A plain date difference returns four
  years eleven months and thirty days, and denies the gratuity.

---

## Development

```
npm install
npm run rates:generate    # copy the rate tables out of the PHP package
npm run build             # esm + cjs + .d.ts, then the browser bundle
npm run typecheck
npm test
```

`npm test` runs the parity suite, the calculator edge cases, the `Money` and
rounding tests, and the widget tests (in happy-dom, including a load of the built
bundle). Node 18 or newer.

## Licence

MIT. These calculators are an aid, not advice - verify against the statute and the
relevant notification before relying on a figure for a filing.
