import type { DateInput } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

/**
 * Reasons an employment may end. Only the ones listed in the rate table's
 * `minimum_waived_on` skip the qualifying period; the rest are here so a typo
 * like "resigned" is caught rather than silently treated as a resignation.
 */
export const SEPARATION_REASONS = [
  'resignation',
  'retirement',
  'superannuation',
  'termination',
  'retrenchment',
  'death',
  'disablement',
] as const;

export type SeparationReason = (typeof SEPARATION_REASONS)[number];

export interface GratuityInput {
  /** Last drawn basic plus dearness allowance. */
  lastDrawnSalary: Money | number | string;
  yearsOfService: number;
  monthsOfService?: number;
  /** Whether the establishment is covered by the Act. Uncovered ones divide by 30. */
  covered?: boolean;
  separationReason?: string;
  asOf?: DateInput;
}

/**
 * Gratuity payable under the Payment of Gratuity Act 1972, split into the
 * section 10(10) exempt portion and the taxable remainder.
 */
export class GratuityResult extends Result {
  constructor(
    readonly gratuity: Money,
    readonly completedYears: number,
    readonly taxExempt: Money,
    readonly taxable: Money,
    readonly eligible: boolean,
    readonly divisor: number,
    readonly multiplier: number,
    readonly lastDrawnSalary: Money,
    readonly yearsOfService: number,
    readonly monthsOfService: number,
    readonly covered: boolean,
    readonly separationReason: string,
    readonly exemptionLimit: Money,
    readonly ineligibilityReason: string | null = null,
  ) {
    super();
  }

  get amount(): Money {
    return this.gratuity;
  }

  static make(steps: Step[], fields: ConstructorParameters<typeof GratuityResult>): GratuityResult {
    return new GratuityResult(...fields).withWorking(steps);
  }

  explain(): string {
    if (!this.eligible) {
      return this.ineligibilityReason ?? 'No gratuity is payable.';
    }

    return (
      `(${this.multiplier} × ${this.lastDrawnSalary.format(false)} × ${this.completedYears}) ÷ ` +
      `${this.divisor} = ${this.gratuity.format()}`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      gratuity: this.gratuity.toRupees(),
      gratuity_formatted: this.gratuity.format(),
      eligible: this.eligible,
      ineligibility_reason: this.ineligibilityReason,
      completed_years: this.completedYears,
      years_of_service: this.yearsOfService,
      months_of_service: this.monthsOfService,
      covered: this.covered,
      separation_reason: this.separationReason,
      multiplier: this.multiplier,
      divisor: this.divisor,
      last_drawn_salary: this.lastDrawnSalary.toRupees(),
      last_drawn_salary_formatted: this.lastDrawnSalary.format(),
      tax_exempt: this.taxExempt.toRupees(),
      tax_exempt_formatted: this.taxExempt.format(),
      taxable: this.taxable.toRupees(),
      taxable_formatted: this.taxable.format(),
      exemption_limit: this.exemptionLimit.toRupees(),
      exemption_limit_formatted: this.exemptionLimit.format(),
    };
  }
}

/**
 * Gratuity under the Payment of Gratuity Act 1972, with the section 10(10)
 * exemption split out.
 */
export class GratuityCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: GratuityInput): GratuityResult {
    const lastDrawnSalary = Money.from(input.lastDrawnSalary);
    const yearsOfService = input.yearsOfService;
    const monthsOfService = input.monthsOfService ?? 0;
    const covered = input.covered ?? true;

    if (lastDrawnSalary.isNegative()) {
      throw InvalidInputError.negative('Last drawn salary');
    }

    if (yearsOfService < 0) {
      throw InvalidInputError.negative('Years of service');
    }

    if (monthsOfService < 0 || monthsOfService > 11) {
      throw InvalidInputError.outOfRange('Months of service', 'between 0 and 11', monthsOfService);
    }

    const reason = String(input.separationReason ?? 'resignation').trim().toLowerCase();

    if (!(SEPARATION_REASONS as readonly string[]).includes(reason)) {
      throw InvalidInputError.unknownOption(
        'separation reason',
        String(input.separationReason ?? ''),
        SEPARATION_REASONS,
      );
    }

    const table = this.rates.for('gratuity', input.asOf);
    const citation = table.citation();

    const multiplier = covered ? table.int('covered_multiplier') : table.int('non_covered_multiplier');
    const divisor = covered ? table.int('covered_divisor') : table.int('non_covered_divisor');
    const exemptionLimit = table.money('tax_exemption_limit');

    const waivedOn = table.array<string>('minimum_waived_on').map(String);
    const minimumYears = table.int('minimum_years_of_service');
    const roundUpAfter = table.int('round_up_after_months');

    // The six-month rule is a feature of the Act's own formula, so it does not
    // travel to establishments outside its coverage - they use a plain 15/30 on
    // completed years only.
    const roundingApplies = covered || table.bool('round_up_applies_to_non_covered');
    const roundedUp = roundingApplies && monthsOfService > roundUpAfter;
    const completedYears = yearsOfService + (roundedUp ? 1 : 0);

    const minimumWaived = waivedOn.includes(reason);

    // The qualifying period runs on actual continuous service, not on the
    // rounded-up figure used for the computation: four years and eight months
    // counts as five years' worth of gratuity, but only once the employee has
    // crossed the five-year threshold in the first place.
    const eligible = minimumWaived || yearsOfService >= minimumYears;

    const steps: Step[] = [
      new Step({
        label: 'Last drawn salary (basic + DA)',
        amount: lastDrawnSalary,
        citation,
        context: { covered },
      }),
      new Step({
        label: 'Completed years of service',
        formula: roundedUp
          ? `${yearsOfService} years ${monthsOfService} months → ${completedYears} (over ${roundUpAfter} months rounds up)`
          : `${yearsOfService} years ${monthsOfService} months → ${completedYears}`,
        citation,
        context: { rounded_up: roundedUp },
      }),
    ];

    if (!eligible) {
      const ineligibilityReason =
        `Gratuity needs ${minimumYears} years of continuous service. ${yearsOfService} years ` +
        `${monthsOfService} months of service on ${reason} does not qualify, and the minimum is waived only ` +
        `on ${waivedOn.join(' or ')}.`;

      steps.push(
        new Step({
          label: 'Qualifying period not met',
          amount: Money.zero(),
          formula: `${yearsOfService} years < ${minimumYears} years`,
          citation,
        }),
      );

      return GratuityResult.make(steps, [
        Money.zero(),
        completedYears,
        Money.zero(),
        Money.zero(),
        false,
        divisor,
        multiplier,
        lastDrawnSalary,
        yearsOfService,
        monthsOfService,
        covered,
        reason,
        exemptionLimit,
        ineligibilityReason,
      ]);
    }

    if (minimumWaived && yearsOfService < minimumYears) {
      steps.push(
        new Step({
          label: `Qualifying period waived on ${reason}`,
          formula: `${yearsOfService} years of service accepted`,
          citation,
        }),
      );
    }

    // One multiply rather than two keeps the single rounding at the divide.
    const gratuity = lastDrawnSalary.multiply(multiplier * completedYears).divide(divisor);

    steps.push(
      new Step({
        label: 'Gratuity payable',
        amount: gratuity,
        formula: `(${multiplier} × ${lastDrawnSalary.format(false)} × ${completedYears}) ÷ ${divisor}`,
        citation,
      }),
    );

    const taxExempt = gratuity.min(exemptionLimit);
    const taxable = gratuity.subtract(taxExempt).floorAtZero();

    steps.push(
      new Step({
        label: 'Exempt under section 10(10)',
        amount: taxExempt,
        formula: `min(${gratuity.format()}, ${exemptionLimit.format()})`,
        citation,
      }),
    );

    if (taxable.isPositive()) {
      steps.push(
        new Step({
          label: 'Taxable as salary',
          amount: taxable,
          formula: `${gratuity.format()} − ${taxExempt.format()}`,
          citation,
        }),
      );
    }

    return GratuityResult.make(steps, [
      gratuity,
      completedYears,
      taxExempt,
      taxable,
      true,
      divisor,
      multiplier,
      lastDrawnSalary,
      yearsOfService,
      monthsOfService,
      covered,
      reason,
      exemptionLimit,
      null,
    ]);
  }
}

/** Gratuity under the Payment of Gratuity Act 1972. */
export function calculateGratuity(input: GratuityInput, rates?: RateRepository): GratuityResult {
  return new GratuityCalculator(rates).calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/gratuity` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const gratuity = calculateGratuity;
