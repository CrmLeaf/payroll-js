import { type DateInput, formatDate, toDate, utcDate } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, rateLabel } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

export interface EsiInput {
  /** Gross wages - a far wider base than PF wages. */
  grossWages: Money | number | string;
  /** The higher wage limit reaches only persons with a disability under the 1995 or 2016 Acts. */
  disabled?: boolean;
  averageDailyWage?: Money | number | string | null;
  continuingFromPriorPeriod?: boolean;
  asOf?: DateInput;
}

export interface ContributionPeriod {
  name: string;
  from: string;
  to: string;
  label: string;
  benefit_from: string;
  benefit_to: string;
  benefit_period: string;
  benefit_label: string;
}

/**
 * One month's ESI position: whether the employee is covered at all, and if so
 * the two shares, each rounded up to the whole rupee in its own right.
 */
export class EsiResult extends Result {
  constructor(
    readonly grossWages: Money,
    readonly applicable: boolean,
    readonly wageLimit: Money,
    readonly employeeRate: number,
    readonly employerRate: number,
    readonly employeeContribution: Money,
    readonly employerContribution: Money,
    readonly totalContribution: Money,
    readonly disabled: boolean,
    readonly employeeExemptByDailyWage: boolean,
    readonly continuingFromPriorPeriod: boolean,
    /** True when the continuation rule, not the wage limit, is what keeps this employee covered. */
    readonly coveredByContinuationRule: boolean,
    readonly averageDailyWage: Money | null,
    readonly dailyWageExemptionLimit: Money,
    readonly contributionPeriod: ContributionPeriod,
    readonly reason: string,
  ) {
    super();
  }

  get amount(): Money {
    return this.totalContribution;
  }

  static make(steps: Step[], fields: ConstructorParameters<typeof EsiResult>): EsiResult {
    return new EsiResult(...fields).withWorking(steps);
  }

  explain(): string {
    if (!this.applicable) {
      return this.reason;
    }

    const gross = this.grossWages.format();

    const employee = this.employeeExemptByDailyWage
      ? `Employee nil (${this.reason})`
      : `Employee ${rateLabel(this.employeeRate)}% × ${gross} = ` +
        `${this.grossWages.percentage(this.employeeRate).format()} rounded up to ${this.employeeContribution.format()}`;

    return (
      `${employee}; employer ${rateLabel(this.employerRate)}% × ${gross} = ` +
      `${this.grossWages.percentage(this.employerRate).format()} rounded up to ${this.employerContribution.format()}; ` +
      `total ${this.totalContribution.format()}`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      gross_wages: this.grossWages.toRupees(),
      gross_wages_formatted: this.grossWages.format(),
      applicable: this.applicable,
      wage_limit: this.wageLimit.toRupees(),
      wage_limit_formatted: this.wageLimit.format(),
      employee_rate: this.employeeRate,
      employer_rate: this.employerRate,
      employee_contribution: this.employeeContribution.toRupees(),
      employee_contribution_formatted: this.employeeContribution.format(),
      employer_contribution: this.employerContribution.toRupees(),
      employer_contribution_formatted: this.employerContribution.format(),
      total_contribution: this.totalContribution.toRupees(),
      total_contribution_formatted: this.totalContribution.format(),
      disabled: this.disabled,
      employee_exempt_by_daily_wage: this.employeeExemptByDailyWage,
      continuing_from_prior_period: this.continuingFromPriorPeriod,
      covered_by_continuation_rule: this.coveredByContinuationRule,
      average_daily_wage: this.averageDailyWage?.toRupees() ?? null,
      average_daily_wage_formatted: this.averageDailyWage?.format() ?? null,
      daily_wage_exemption_limit: this.dailyWageExemptionLimit.toRupees(),
      daily_wage_exemption_limit_formatted: this.dailyWageExemptionLimit.format(),
      contribution_period: this.contributionPeriod,
      reason: this.reason,
    };
  }
}

/** Monthly Employees' State Insurance contributions for one employee. */
export class EsiCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: EsiInput): EsiResult {
    const grossWages = Money.from(input.grossWages);
    const disabled = input.disabled ?? false;
    const averageDailyWage =
      input.averageDailyWage === null || input.averageDailyWage === undefined
        ? null
        : Money.from(input.averageDailyWage);
    const continuingFromPriorPeriod = input.continuingFromPriorPeriod ?? false;

    if (grossWages.isNegative()) {
      throw InvalidInputError.negative('Gross wages');
    }

    if (averageDailyWage !== null && averageDailyWage.isNegative()) {
      throw InvalidInputError.negative('Average daily wage');
    }

    const table = this.rates.for('esi', input.asOf);
    const citation = table.citation();

    // Section 2(9) read with rule 50: the higher limit applies only to a person
    // with disability engaged under the 1995 or 2016 disability Acts.
    const limit = disabled ? table.money('wage_limit_disabled') : table.money('wage_limit');
    const withinLimit = grossWages.lessThanOrEqual(limit);
    const applicable = withinLimit || continuingFromPriorPeriod;

    const employeeRate = table.float('employee_rate');
    const employerRate = table.float('employer_rate');
    const dailyLimit = table.money('daily_wage_exemption_limit');
    const period = this.contributionPeriodFor(input.asOf, input.asOf);

    if (!applicable) {
      const reason =
        `Not covered: gross wages of ${grossWages.format()} exceed the ${limit.format()} wage limit, and the ` +
        `employee was not already contributing in the current contribution period (${period.label}).`;

      return EsiResult.make(
        [
          new Step({
            label: 'Coverage',
            formula: `${grossWages.format()} > ${limit.format()}`,
            citation,
            context: { applicable: false, disabled },
          }),
        ],
        [
          grossWages,
          false,
          limit,
          employeeRate,
          employerRate,
          Money.zero(),
          Money.zero(),
          Money.zero(),
          disabled,
          false,
          continuingFromPriorPeriod,
          false,
          averageDailyWage,
          dailyLimit,
          period,
          reason,
        ],
      );
    }

    const steps: Step[] = [
      new Step({
        label: 'Coverage',
        formula: withinLimit
          ? `${grossWages.format()} ≤ ${limit.format()}`
          : `${grossWages.format()} > ${limit.format()}, but contributions began in the ${period.name} ` +
            'contribution period and continue to its end',
        citation,
        context: { applicable: true, disabled },
      }),
    ];

    // Rule 52: an employee whose average daily wage is at or below the threshold
    // is relieved of his own share, but this is an exemption for the employee
    // alone - the employer's 3.25% is unaffected.
    const employeeExempt = averageDailyWage !== null && averageDailyWage.lessThanOrEqual(dailyLimit);

    // Rule 51 requires each share to be rounded up to the next rupee on its own.
    // Rounding the combined 4% instead loses a rupee on most wages and will not
    // reconcile against the ESIC challan.
    const employee = employeeExempt ? Money.zero() : grossWages.percentage(employeeRate).roundUpToRupee();
    const employer = grossWages.percentage(employerRate).roundUpToRupee();

    steps.push(
      new Step({
        label: 'Employee contribution',
        amount: employee,
        formula: employeeExempt
          ? `nil - average daily wage ${averageDailyWage!.format()} ≤ ${dailyLimit.format()}`
          : `roundup(${rateLabel(employeeRate)}% × ${grossWages.format()}) = ` +
            `roundup(${grossWages.percentage(employeeRate).format()})`,
        citation,
      }),
      new Step({
        label: 'Employer contribution',
        amount: employer,
        formula:
          `roundup(${rateLabel(employerRate)}% × ${grossWages.format()}) = ` +
          `roundup(${grossWages.percentage(employerRate).format()})`,
        citation,
      }),
    );

    const total = employee.add(employer);

    steps.push(
      new Step({
        label: 'Total contribution',
        amount: total,
        formula: `${employee.format()} + ${employer.format()}`,
      }),
      new Step({
        label: 'Contribution period',
        formula: period.label,
        citation,
        context: { benefit_period: period.benefit_label },
      }),
    );

    let reason = withinLimit
      ? `Covered: gross wages of ${grossWages.format()} are within the ${limit.format()} wage limit.`
      : `Covered by the contribution-period rule: gross wages of ${grossWages.format()} now exceed the ` +
        `${limit.format()} limit, but contributions that have begun in a contribution period run to the end of ` +
        `it, so deductions continue on the higher wages until ${period.to} and coverage ceases only from the ` +
        'next period.';

    if (employeeExempt) {
      reason =
        `Employee share nil: the average daily wage of ${averageDailyWage!.format()} does not exceed ` +
        `${dailyLimit.format()}, so the employee is exempt under rule 52 while the employer continues to pay ` +
        `its ${rateLabel(employerRate)}% share.`;
    }

    return EsiResult.make(steps, [
      grossWages,
      true,
      limit,
      employeeRate,
      employerRate,
      employee,
      employer,
      total,
      disabled,
      employeeExempt,
      continuingFromPriorPeriod,
      !withinLimit,
      averageDailyWage,
      dailyLimit,
      period,
      reason,
    ]);
  }

  /**
   * The contribution period a date falls in, resolved to real dates.
   *
   * The two periods run April-September and October-March, and the second one
   * straddles the new year - a date in February belongs to the period that began
   * on 1 October of the *previous* calendar year, which is exactly the off-by-one
   * that makes people compute the wrong benefit period.
   */
  contributionPeriodFor(date: DateInput = null, asOf: DateInput = null): ContributionPeriod {
    const on = toDate(date);
    const table = this.rates.for('esi', asOf ?? on);

    const periods = table.array<Record<string, string>>('contribution_periods');

    const monthDay = formatDate(on, 'm-d');
    const calendarYear = on.getUTCFullYear();

    for (const period of periods) {
      const from = String(period.from);
      const to = String(period.to);
      const wraps = from > to;

      const matches = wraps ? monthDay >= from || monthDay <= to : monthDay >= from && monthDay <= to;

      if (!matches) continue;

      // For the wrapping period the start year is the previous calendar year
      // once we are past the turn of the year.
      const startYear = wraps && monthDay <= to ? calendarYear - 1 : calendarYear;
      const endYear = wraps ? startYear + 1 : startYear;

      const start = toDate(`${startYear}-${from}`);
      const end = toDate(`${endYear}-${to}`);

      // "the following year" in the rate table is relative to the year the
      // contribution period opened, which holds for both periods.
      const benefit = String(period.benefit_period ?? '');
      const [benefitFrom, benefitTo] = EsiCalculator.benefitDates(benefit, startYear + 1);

      return {
        name: String(period.name),
        from: formatDate(start, 'Y-m-d'),
        to: formatDate(end, 'Y-m-d'),
        label: `${formatDate(start, 'F Y')} to ${formatDate(end, 'F Y')}`,
        benefit_from: benefitFrom,
        benefit_to: benefitTo,
        benefit_period: benefit,
        benefit_label:
          benefitFrom !== '' && benefitTo !== ''
            ? `${formatDate(toDate(benefitFrom), 'j F Y')} to ${formatDate(toDate(benefitTo), 'j F Y')}`
            : benefit,
      };
    }

    throw InvalidInputError.outOfRange(
      'Date',
      'inside a published ESI contribution period',
      formatDate(on, 'Y-m-d'),
    );
  }

  private static benefitDates(descriptor: string, forYear: number): [string, string] {
    const matched = /^(\d{2}-\d{2}) to (\d{2}-\d{2})/.exec(descriptor);
    if (!matched) return ['', ''];

    return [
      formatDate(utcDate(forYear, Number(matched[1].slice(0, 2)), Number(matched[1].slice(3, 5))), 'Y-m-d'),
      formatDate(utcDate(forYear, Number(matched[2].slice(0, 2)), Number(matched[2].slice(3, 5))), 'Y-m-d'),
    ];
  }
}

/** Monthly Employees' State Insurance contributions for one employee. */
export function calculateEsi(input: EsiInput, rates?: RateRepository): EsiResult {
  return new EsiCalculator(rates).calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/esi` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const esi = calculateEsi;
