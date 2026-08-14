import type { DateInput } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';
import {
  type DeductionClaims,
  IncomeTaxCalculator,
  type IncomeTaxResult,
} from './income-tax.js';

export interface TdsInput {
  monthlyGross: Money | number | string;
  regime?: string;
  age?: number;
  deductions?: DeductionClaims;
  /** Months of the financial year still to be paid, so a mid-year joiner works. */
  monthsRemaining?: number;
  taxAlreadyDeducted?: Money | number | string | null;
  asOf?: DateInput;
}

/** Monthly tax deducted at source on salary under section 192. */
export class TdsResult extends Result {
  constructor(
    readonly monthlyGross: Money,
    readonly annualGross: Money,
    readonly annualTax: Money,
    readonly alreadyDeducted: Money,
    readonly balanceTax: Money,
    readonly monthlyTds: Money,
    readonly excessAlreadyDeducted: Money,
    readonly monthsRemaining: number,
    readonly regime: string,
    readonly tax: IncomeTaxResult,
  ) {
    super();
  }

  get amount(): Money {
    return this.monthlyTds;
  }

  static withSteps(result: TdsResult, steps: Step[]): TdsResult {
    return result.withWorking(steps);
  }

  explain(): string {
    return (
      `(${this.annualTax.format()} annual tax on ${this.monthlyGross.format()} × 12 − ` +
      `${this.alreadyDeducted.format()} already deducted) ÷ ${this.monthsRemaining} ` +
      `month${this.monthsRemaining === 1 ? '' : 's'} = ${this.monthlyTds.format()} per month`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      regime: this.regime,
      months_remaining: this.monthsRemaining,
      monthly_gross: this.monthlyGross.toRupees(),
      monthly_gross_formatted: this.monthlyGross.format(),
      annual_gross: this.annualGross.toRupees(),
      annual_gross_formatted: this.annualGross.format(),
      annual_tax: this.annualTax.toRupees(),
      annual_tax_formatted: this.annualTax.format(),
      already_deducted: this.alreadyDeducted.toRupees(),
      already_deducted_formatted: this.alreadyDeducted.format(),
      balance_tax: this.balanceTax.toRupees(),
      balance_tax_formatted: this.balanceTax.format(),
      monthly_tds: this.monthlyTds.toRupees(),
      monthly_tds_formatted: this.monthlyTds.format(),
      excess_already_deducted: this.excessAlreadyDeducted.toRupees(),
      excess_already_deducted_formatted: this.excessAlreadyDeducted.format(),
      income_tax: this.tax.toArray(),
    };
  }
}

export interface RegimeComparison {
  new: TdsResult;
  old: TdsResult;
  cheaper: 'new' | 'old' | 'equal';
  annual_saving: Money;
  monthly_saving: Money;
  summary: string;
}

/**
 * Monthly tax deducted at source on salary under section 192.
 *
 * Section 192 requires the employer to estimate the whole year's liability and
 * deduct it in roughly equal instalments over the months of employment, not to
 * tax each month in isolation. So the monthly gross is annualised first, the full
 * income-tax computation runs on that, and only the balance after tax already
 * deducted is spread over the months that remain - which is why a mid-year joiner
 * or a mid-year revision changes every remaining instalment.
 */
export class TdsCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: TdsInput): TdsResult {
    const monthlyGross = Money.from(input.monthlyGross);
    const monthsRemaining = input.monthsRemaining ?? 12;

    if (monthlyGross.isNegative()) {
      throw InvalidInputError.negative('Monthly gross');
    }

    if (monthsRemaining < 1 || monthsRemaining > 12) {
      throw InvalidInputError.outOfRange('Months remaining', 'between 1 and 12', monthsRemaining);
    }

    const taxAlreadyDeducted =
      input.taxAlreadyDeducted === null || input.taxAlreadyDeducted === undefined
        ? Money.zero()
        : Money.from(input.taxAlreadyDeducted);

    if (taxAlreadyDeducted.isNegative()) {
      throw InvalidInputError.negative('Tax already deducted');
    }

    const annualGross = monthlyGross.multiply(12);

    const tax = new IncomeTaxCalculator(this.rates).calculate({
      grossSalary: annualGross,
      regime: input.regime ?? 'new',
      age: input.age ?? 30,
      deductions: input.deductions ?? {},
      asOf: input.asOf,
    });

    const balance = tax.totalTax.subtract(taxAlreadyDeducted);
    const excess = balance.isNegative() ? balance.multiply(-1) : Money.zero();

    // TDS is deducted in whole rupees. Rounding the instalment rather than the
    // annual figure keeps twelve instalments within a rupee of the liability; the
    // March payroll absorbs the remainder in practice.
    const monthlyTds = balance.floorAtZero().divide(monthsRemaining).roundToRupee();

    const citation = `${this.rates.for('income-tax', input.asOf).statute} - section 192, tax deducted at source on salary`;

    const steps: Step[] = [
      ...tax.workings,
      new Step({
        label: 'Annualised salary',
        amount: annualGross,
        formula: `${monthlyGross.format()} × 12`,
        citation,
      }),
      new Step({
        label: 'Balance tax to recover',
        amount: balance,
        formula: `${tax.totalTax.format()} annual tax − ${taxAlreadyDeducted.format()} already deducted`,
        citation,
      }),
      new Step({
        label: 'Monthly TDS',
        amount: monthlyTds,
        formula: `${balance.floorAtZero().format()} ÷ ${monthsRemaining}`,
        citation,
      }),
    ];

    const result = new TdsResult(
      monthlyGross,
      annualGross,
      tax.totalTax,
      taxAlreadyDeducted,
      balance,
      monthlyTds,
      excess,
      monthsRemaining,
      tax.regime,
      tax,
    );

    return TdsResult.withSteps(result, steps);
  }

  /**
   * Both regimes side by side - the only question most employees actually have
   * when the declaration form lands in January.
   *
   * The same deduction claims are put to both: the new regime will refuse most of
   * them, and that refusal is exactly what the comparison is measuring.
   */
  compareRegimes(input: Omit<TdsInput, 'regime'>): RegimeComparison {
    const newRegime = this.calculate({ ...input, regime: 'new' });
    const oldRegime = this.calculate({ ...input, regime: 'old' });

    let cheaper: 'new' | 'old' | 'equal';
    let saving: Money;

    if (newRegime.annualTax.equals(oldRegime.annualTax)) {
      cheaper = 'equal';
      saving = Money.zero();
    } else if (newRegime.annualTax.lessThan(oldRegime.annualTax)) {
      cheaper = 'new';
      saving = oldRegime.annualTax.subtract(newRegime.annualTax);
    } else {
      cheaper = 'old';
      saving = newRegime.annualTax.subtract(oldRegime.annualTax);
    }

    const summary =
      cheaper === 'equal'
        ? `Both regimes come to ${newRegime.annualTax.format()}. The new regime applies by default.`
        : `The ${cheaper} regime is cheaper by ${saving.format()} a year (${
            cheaper === 'new' ? newRegime.annualTax.format() : oldRegime.annualTax.format()
          } versus ${cheaper === 'new' ? oldRegime.annualTax.format() : newRegime.annualTax.format()}).`;

    return {
      new: newRegime,
      old: oldRegime,
      cheaper,
      annual_saving: saving,
      monthly_saving: saving.divide(12),
      summary,
    };
  }
}

/** Monthly tax deducted at source on salary under section 192. */
export function calculateTds(input: TdsInput, rates?: RateRepository): TdsResult {
  return new TdsCalculator(rates).calculate(input);
}

/** Both regimes side by side. */
export function compareRegimes(input: Omit<TdsInput, 'regime'>, rates?: RateRepository): RegimeComparison {
  return new TdsCalculator(rates).compareRegimes(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/tds` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const tds = calculateTds;
