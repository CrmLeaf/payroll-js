import type { DateInput } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

/**
 * A month is taken at 30 days when converting average monthly salary to a daily
 * rate. That divisor is settled practice rather than a figure in the section,
 * which is why it is a constant here and not a rate-table value.
 */
const DAYS_IN_MONTH = 30;

export const LIMB_ACTUAL = 'actual_encashment';
export const LIMB_STATUTORY_LIMIT = 'statutory_limit';
export const LIMB_MONTHS_OF_SALARY = 'months_of_salary';
export const LIMB_LEAVE_CREDIT = 'leave_credit';
export const LIMB_GOVERNMENT = 'government_employee';
export const LIMB_IN_SERVICE = 'encashed_in_service';

export interface LeaveEncashmentInput {
  /** Average of the last ten months' basic plus DA. */
  averageMonthlySalary: Money | number | string;
  leaveDaysEncashed: number;
  yearsOfService: number;
  governmentEmployee?: boolean;
  /** Encashment drawn while still employed is ordinary salary, fully taxable. */
  duringService?: boolean;
  exemptionAlreadyClaimed?: Money | number | string | null;
  asOf?: DateInput;
}

/** Leave encashment and the section 10(10AA) exemption on it. */
export class LeaveEncashmentResult extends Result {
  constructor(
    readonly encashment: Money,
    readonly exemption: Money,
    readonly taxable: Money,
    readonly limbActual: Money,
    readonly limbStatutoryLimit: Money,
    readonly limbMonthsOfSalary: Money,
    readonly limbLeaveCredit: Money,
    readonly bindingLimb: string,
    readonly averageMonthlySalary: Money,
    readonly perDaySalary: Money,
    readonly leaveDaysEncashed: number,
    readonly eligibleLeaveDays: number,
    readonly yearsOfService: number,
    readonly governmentEmployee: boolean,
    readonly duringService: boolean,
    readonly exemptionLimit: Money,
    readonly exemptionAlreadyClaimed: Money,
  ) {
    super();
  }

  get amount(): Money {
    return this.encashment;
  }

  static make(
    steps: Step[],
    fields: ConstructorParameters<typeof LeaveEncashmentResult>,
  ): LeaveEncashmentResult {
    return new LeaveEncashmentResult(...fields).withWorking(steps);
  }

  explain(): string {
    if (this.governmentEmployee) {
      return `Government employee - the whole ${this.encashment.format()} is exempt under section 10(10AA)(i).`;
    }

    if (this.duringService) {
      return `Encashed while in service - the whole ${this.encashment.format()} is taxable as salary.`;
    }

    return (
      `Least of ${this.limbActual.format()}, ${this.limbStatutoryLimit.format()}, ` +
      `${this.limbMonthsOfSalary.format()} and ${this.limbLeaveCredit.format()} = ${this.exemption.format()} ` +
      `exempt (${this.bindingLimb.replace(/_/g, ' ')} bound), ${this.taxable.format()} taxable`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      encashment: this.encashment.toRupees(),
      encashment_formatted: this.encashment.format(),
      exemption: this.exemption.toRupees(),
      exemption_formatted: this.exemption.format(),
      taxable: this.taxable.toRupees(),
      taxable_formatted: this.taxable.format(),
      binding_limb: this.bindingLimb,
      limbs: {
        actual_encashment: this.limbActual.toRupees(),
        actual_encashment_formatted: this.limbActual.format(),
        statutory_limit: this.limbStatutoryLimit.toRupees(),
        statutory_limit_formatted: this.limbStatutoryLimit.format(),
        months_of_salary: this.limbMonthsOfSalary.toRupees(),
        months_of_salary_formatted: this.limbMonthsOfSalary.format(),
        leave_credit: this.limbLeaveCredit.toRupees(),
        leave_credit_formatted: this.limbLeaveCredit.format(),
      },
      average_monthly_salary: this.averageMonthlySalary.toRupees(),
      average_monthly_salary_formatted: this.averageMonthlySalary.format(),
      per_day_salary: this.perDaySalary.toRupees(),
      per_day_salary_formatted: this.perDaySalary.format(),
      leave_days_encashed: this.leaveDaysEncashed,
      eligible_leave_days: this.eligibleLeaveDays,
      years_of_service: this.yearsOfService,
      government_employee: this.governmentEmployee,
      during_service: this.duringService,
      exemption_limit: this.exemptionLimit.toRupees(),
      exemption_limit_formatted: this.exemptionLimit.format(),
      exemption_already_claimed: this.exemptionAlreadyClaimed.toRupees(),
      exemption_already_claimed_formatted: this.exemptionAlreadyClaimed.format(),
    };
  }
}

/** Leave encashment and the section 10(10AA) exemption on it. */
export class LeaveEncashmentCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: LeaveEncashmentInput): LeaveEncashmentResult {
    const averageMonthlySalary = Money.from(input.averageMonthlySalary);
    const { leaveDaysEncashed, yearsOfService } = input;
    const governmentEmployee = input.governmentEmployee ?? false;
    const duringService = input.duringService ?? false;

    if (averageMonthlySalary.isNegative()) {
      throw InvalidInputError.negative('Average monthly salary');
    }

    if (leaveDaysEncashed < 0) {
      throw InvalidInputError.negative('Leave days encashed');
    }

    if (yearsOfService < 0) {
      throw InvalidInputError.negative('Years of service');
    }

    const alreadyClaimed =
      input.exemptionAlreadyClaimed === null || input.exemptionAlreadyClaimed === undefined
        ? Money.zero()
        : Money.from(input.exemptionAlreadyClaimed);

    if (alreadyClaimed.isNegative()) {
      throw InvalidInputError.negative('Exemption already claimed');
    }

    const table = this.rates.for('leave-encashment', input.asOf);
    const citation = table.citation();

    const exemptionLimit = table.money('exemption_limit');
    const monthsExempt = table.int('months_of_salary_exempt');
    const maxLeaveDaysPerYear = table.int('max_leave_days_per_year');

    // The per-day figure is reported for the working, but every total is taken
    // from the monthly salary in one step. Rounding a 30th of a salary to the
    // paisa first and then multiplying by 200 days drifts by most of a rupee,
    // which is exactly the sort of mismatch that gets queried.
    const perDaySalary = averageMonthlySalary.divide(DAYS_IN_MONTH);
    const encashment = daysOfSalary(averageMonthlySalary, leaveDaysEncashed);

    const steps: Step[] = [
      new Step({
        label: 'Average monthly salary (basic + DA)',
        amount: averageMonthlySalary,
        formula: `average of the last ${table.int('average_salary_months')} months`,
        citation,
      }),
      new Step({
        label: 'Per-day salary',
        amount: perDaySalary,
        formula: `${averageMonthlySalary.format()} ÷ ${DAYS_IN_MONTH}`,
        citation,
      }),
      new Step({
        label: `Encashment for ${leaveDaysEncashed} day(s)`,
        amount: encashment,
        formula: `(${averageMonthlySalary.format()} × ${leaveDaysEncashed}) ÷ ${DAYS_IN_MONTH}`,
        citation,
      }),
    ];

    // Leave credit is capped at 30 days for every completed year of service
    // however generous the employer's own leave policy is.
    const eligibleLeaveDays = Math.min(leaveDaysEncashed, maxLeaveDaysPerYear * yearsOfService);

    const limbActual = encashment;
    const limbStatutoryLimit = exemptionLimit.subtract(alreadyClaimed).floorAtZero();
    const limbMonthsOfSalary = averageMonthlySalary.multiply(monthsExempt);
    const limbLeaveCredit = daysOfSalary(averageMonthlySalary, eligibleLeaveDays);

    const common = [
      limbActual,
      limbStatutoryLimit,
      limbMonthsOfSalary,
      limbLeaveCredit,
    ] as const;

    if (duringService) {
      // Section 10(10AA) only reaches encashment on retirement or resignation.
      // Anything drawn while still employed is ordinary salary, and that holds
      // for government employees too.
      steps.push(
        new Step({ label: 'Encashed while in service - fully taxable', amount: encashment, citation }),
      );

      return LeaveEncashmentResult.make(steps, [
        encashment,
        Money.zero(),
        encashment,
        ...common,
        LIMB_IN_SERVICE,
        averageMonthlySalary,
        perDaySalary,
        leaveDaysEncashed,
        eligibleLeaveDays,
        yearsOfService,
        governmentEmployee,
        true,
        exemptionLimit,
        alreadyClaimed,
      ]);
    }

    if (governmentEmployee && table.bool('government_employees_fully_exempt')) {
      steps.push(
        new Step({
          label: 'Government employee - wholly exempt under section 10(10AA)(i)',
          amount: encashment,
          citation,
        }),
      );

      return LeaveEncashmentResult.make(steps, [
        encashment,
        encashment,
        Money.zero(),
        ...common,
        LIMB_GOVERNMENT,
        averageMonthlySalary,
        perDaySalary,
        leaveDaysEncashed,
        eligibleLeaveDays,
        yearsOfService,
        true,
        false,
        exemptionLimit,
        alreadyClaimed,
      ]);
    }

    const exemption = limbActual.min(limbStatutoryLimit, limbMonthsOfSalary, limbLeaveCredit);
    const taxable = encashment.subtract(exemption).floorAtZero();

    const limbs: Array<[string, Money]> = [
      [LIMB_ACTUAL, limbActual],
      [LIMB_STATUTORY_LIMIT, limbStatutoryLimit],
      [LIMB_MONTHS_OF_SALARY, limbMonthsOfSalary],
      [LIMB_LEAVE_CREDIT, limbLeaveCredit],
    ];

    let bindingLimb = LIMB_ACTUAL;
    for (const [name, value] of limbs) {
      if (value.equals(exemption)) {
        bindingLimb = name;
        break;
      }
    }

    steps.push(
      new Step({ label: 'Limb (a) actual encashment received', amount: limbActual, citation }),
      new Step({
        label: 'Limb (b) statutory ceiling less exemption already claimed',
        amount: limbStatutoryLimit,
        formula: `${exemptionLimit.format()} − ${alreadyClaimed.format()}`,
        citation,
      }),
      new Step({
        label: `Limb (c) ${monthsExempt} months of average salary`,
        amount: limbMonthsOfSalary,
        formula: `${monthsExempt} × ${averageMonthlySalary.format()}`,
        citation,
      }),
      new Step({
        label: 'Limb (d) cash equivalent of leave at 30 days a year',
        amount: limbLeaveCredit,
        formula:
          `min(${leaveDaysEncashed}, ${maxLeaveDaysPerYear} × ${yearsOfService}) = ${eligibleLeaveDays} days → ` +
          `(${averageMonthlySalary.format()} × ${eligibleLeaveDays}) ÷ ${DAYS_IN_MONTH}`,
        citation,
      }),
      new Step({
        label: 'Exempt - least of the four',
        amount: exemption,
        formula: `limb (${limbLetter(bindingLimb)}) binds`,
        citation,
      }),
      new Step({
        label: 'Taxable as salary',
        amount: taxable,
        formula: `${encashment.format()} − ${exemption.format()}`,
        citation,
      }),
    );

    return LeaveEncashmentResult.make(steps, [
      encashment,
      exemption,
      taxable,
      ...common,
      bindingLimb,
      averageMonthlySalary,
      perDaySalary,
      leaveDaysEncashed,
      eligibleLeaveDays,
      yearsOfService,
      false,
      false,
      exemptionLimit,
      alreadyClaimed,
    ]);
  }
}

/** The cash equivalent of a number of days, taken from the monthly figure in a single rounding. */
function daysOfSalary(monthlySalary: Money, days: number): Money {
  return monthlySalary.multiply(days).divide(DAYS_IN_MONTH);
}

function limbLetter(limb: string): string {
  switch (limb) {
    case LIMB_ACTUAL:
      return 'a';
    case LIMB_STATUTORY_LIMIT:
      return 'b';
    case LIMB_MONTHS_OF_SALARY:
      return 'c';
    case LIMB_LEAVE_CREDIT:
      return 'd';
    default:
      return '-';
  }
}

/** Leave encashment and the section 10(10AA) exemption on it. */
export function calculateLeaveEncashment(
  input: LeaveEncashmentInput,
  rates?: RateRepository,
): LeaveEncashmentResult {
  return new LeaveEncashmentCalculator(rates).calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/leaveEncashment` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const leaveEncashment = calculateLeaveEncashment;
