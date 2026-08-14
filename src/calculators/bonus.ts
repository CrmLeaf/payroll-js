import type { DateInput } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, rateLabel } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

export interface BonusInput {
  monthlyWages: Money | number | string;
  /** 8.33% is the statutory floor and 20% the cap. */
  bonusRate?: number;
  monthsWorked?: number;
  daysWorked?: number;
  /** The minimum wage notified for the scheduled employment, where one exceeds ₹7,000. */
  minimumWage?: Money | number | string | null;
  asOf?: DateInput;
}

/**
 * Statutory bonus under the Payment of Bonus Act 1965.
 *
 * The two wage figures are kept apart on purpose. `monthlyWages` decides
 * eligibility; `ceilingWage` is what the bonus is actually computed on, and for
 * anyone earning above ₹7,000 those are different numbers.
 */
export class BonusResult extends Result {
  constructor(
    readonly bonus: Money,
    readonly monthlyBonus: Money,
    readonly eligible: boolean,
    readonly monthlyWages: Money,
    readonly ceilingWage: Money,
    readonly calculationCeiling: Money,
    readonly eligibilityLimit: Money,
    readonly bonusRate: number,
    readonly monthsWorked: number,
    readonly daysWorked: number,
    readonly minimumWage: Money | null = null,
    readonly ineligibilityReason: string | null = null,
  ) {
    super();
  }

  get amount(): Money {
    return this.bonus;
  }

  static make(steps: Step[], fields: ConstructorParameters<typeof BonusResult>): BonusResult {
    return new BonusResult(...fields).withWorking(steps);
  }

  /**
   * True where the bonus is computed on a figure lower than the employee's
   * actual wages - the case people most often get wrong.
   */
  ceilingApplied(): boolean {
    return this.ceilingWage.lessThan(this.monthlyWages);
  }

  explain(): string {
    if (!this.eligible) {
      return this.ineligibilityReason ?? 'No statutory bonus is payable.';
    }

    return (
      `${this.ceilingWage.format(false)} × ${rateLabel(this.bonusRate)}% × ${this.monthsWorked} = ` +
      `${this.bonus.format()}`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      bonus: this.bonus.toRupees(),
      bonus_formatted: this.bonus.format(),
      monthly_bonus: this.monthlyBonus.toRupees(),
      monthly_bonus_formatted: this.monthlyBonus.format(),
      eligible: this.eligible,
      ineligibility_reason: this.ineligibilityReason,
      monthly_wages: this.monthlyWages.toRupees(),
      monthly_wages_formatted: this.monthlyWages.format(),
      ceiling_wage: this.ceilingWage.toRupees(),
      ceiling_wage_formatted: this.ceilingWage.format(),
      ceiling_applied: this.ceilingApplied(),
      calculation_ceiling: this.calculationCeiling.toRupees(),
      calculation_ceiling_formatted: this.calculationCeiling.format(),
      eligibility_limit: this.eligibilityLimit.toRupees(),
      eligibility_limit_formatted: this.eligibilityLimit.format(),
      minimum_wage: this.minimumWage?.toRupees() ?? null,
      minimum_wage_formatted: this.minimumWage?.format() ?? null,
      bonus_rate: this.bonusRate,
      months_worked: this.monthsWorked,
      days_worked: this.daysWorked,
    };
  }
}

/** Statutory bonus under the Payment of Bonus Act 1965. */
export class BonusCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: BonusInput): BonusResult {
    const monthlyWages = Money.from(input.monthlyWages);
    const bonusRate = input.bonusRate ?? 8.33;
    const monthsWorked = input.monthsWorked ?? 12;
    const daysWorked = input.daysWorked ?? 30;
    const minimumWage =
      input.minimumWage === null || input.minimumWage === undefined ? null : Money.from(input.minimumWage);

    if (monthlyWages.isNegative()) {
      throw InvalidInputError.negative('Monthly wages');
    }

    if (minimumWage !== null && minimumWage.isNegative()) {
      throw InvalidInputError.negative('Minimum wage');
    }

    if (daysWorked < 0) {
      throw InvalidInputError.negative('Days worked');
    }

    const table = this.rates.for('bonus', input.asOf);
    const citation = table.citation();

    const monthsInYear = table.int('months_in_year');

    if (monthsWorked < 0 || monthsWorked > monthsInYear) {
      throw InvalidInputError.outOfRange('Months worked', `between 0 and ${monthsInYear}`, monthsWorked);
    }

    const minimumRate = table.float('minimum_rate');
    const maximumRate = table.float('maximum_rate');

    // 8.33% is the statutory floor payable irrespective of allocable surplus and
    // 20% the cap, so a rate outside that band is a caller error rather than
    // something to quietly clamp.
    if (bonusRate < minimumRate || bonusRate > maximumRate) {
      throw InvalidInputError.outOfRange('Bonus rate', `between ${minimumRate}% and ${maximumRate}%`, bonusRate);
    }

    const eligibilityLimit = table.money('eligibility_wage_limit');
    const statutoryCeiling = table.money('calculation_ceiling');
    const minimumWorkingDays = table.int('minimum_working_days');

    // The calculation ceiling is ₹7,000 or the notified minimum wage for the
    // scheduled employment, whichever is higher. Before the 2015 amendment there
    // was no minimum-wage limb at all, hence the flag.
    const usesMinimumWage = table.bool('calculation_ceiling_uses_minimum_wage');
    const calculationCeiling =
      usesMinimumWage && minimumWage !== null ? statutoryCeiling.max(minimumWage) : statutoryCeiling;

    // Eligibility looks at actual wages; the bonus is then computed on the lower
    // of actual wages and the ceiling. An employee on ₹18,000 is eligible but
    // earns bonus on ₹7,000.
    const ceilingWage = monthlyWages.min(calculationCeiling);

    const steps: Step[] = [
      new Step({ label: 'Monthly wages', amount: monthlyWages, citation }),
      new Step({
        label: 'Eligibility wage limit',
        amount: eligibilityLimit,
        formula: `${monthlyWages.format()} ${
          monthlyWages.lessThanOrEqual(eligibilityLimit) ? '≤' : '>'
        } ${eligibilityLimit.format()}`,
        citation,
      }),
    ];

    const reasons: string[] = [];

    if (monthlyWages.greaterThan(eligibilityLimit)) {
      reasons.push(
        `monthly wages of ${monthlyWages.format()} exceed the ${eligibilityLimit.format()} eligibility limit`,
      );
    }

    if (daysWorked < minimumWorkingDays) {
      reasons.push(`${daysWorked} days worked is under the ${minimumWorkingDays}-day qualifying period`);
    }

    if (reasons.length > 0) {
      const ineligibilityReason = `No statutory bonus is payable: ${reasons.join(' and ')}.`;

      steps.push(
        new Step({
          label: 'Not eligible',
          amount: Money.zero(),
          formula: ineligibilityReason,
          citation,
        }),
      );

      return BonusResult.make(steps, [
        Money.zero(),
        Money.zero(),
        false,
        monthlyWages,
        ceilingWage,
        calculationCeiling,
        eligibilityLimit,
        bonusRate,
        monthsWorked,
        daysWorked,
        minimumWage,
        ineligibilityReason,
      ]);
    }

    steps.push(
      new Step({
        label: 'Wage the bonus is computed on',
        amount: ceilingWage,
        formula: `min(${monthlyWages.format()}, max(${statutoryCeiling.format()}, ${
          minimumWage?.format() ?? 'no notified minimum wage'
        }))`,
        citation,
        context: { ceiling_applied: ceilingWage.lessThan(monthlyWages) },
      }),
    );

    const monthlyBonus = ceilingWage.percentage(bonusRate);
    const bonus = monthlyBonus.multiply(monthsWorked);

    steps.push(
      new Step({
        label: `Bonus at ${bonusRate}%`,
        amount: monthlyBonus,
        formula: `${ceilingWage.format()} × ${bonusRate}%`,
        citation,
      }),
      new Step({
        label: `Bonus for ${monthsWorked} month(s)`,
        amount: bonus,
        formula: `${monthlyBonus.format()} × ${monthsWorked}`,
        citation,
      }),
    );

    return BonusResult.make(steps, [
      bonus,
      monthlyBonus,
      true,
      monthlyWages,
      ceilingWage,
      calculationCeiling,
      eligibilityLimit,
      bonusRate,
      monthsWorked,
      daysWorked,
      minimumWage,
      null,
    ]);
  }
}

/** Statutory bonus under the Payment of Bonus Act 1965. */
export function calculateBonus(input: BonusInput, rates?: RateRepository): BonusResult {
  return new BonusCalculator(rates).calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/bonus` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const bonus = calculateBonus;
