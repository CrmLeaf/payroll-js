import type { DateInput } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, rateLabel } from '../money.js';
import { RateRepository, type RateTable, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

export interface PfInput {
  /** Basic wages plus dearness allowance. */
  basicSalary: Money | number | string;
  /** Para 26A permits, but does not require, contribution limited to the ceiling. */
  employerRestrictsToCeiling?: boolean;
  epsEligible?: boolean;
  age?: number | null;
  reducedRate?: boolean;
  includeAdminCharges?: boolean;
  asOf?: DateInput;
}

/**
 * One month's provident fund position for one employee: the two 12% shares, the
 * EPS slice carved out of the employer's, and the EDLI and administration
 * charges the employer bears on top.
 */
export class PfResult extends Result {
  constructor(
    readonly basicSalary: Money,
    readonly pfWages: Money,
    readonly wageCeiling: Money,
    readonly restrictedToCeiling: boolean,
    readonly contributionRate: number,
    readonly employeeContribution: Money,
    readonly employerEpf: Money,
    readonly employerEps: Money,
    readonly employerTotal: Money,
    readonly edli: Money,
    readonly adminCharges: Money,
    readonly totalCostToEmployer: Money,
    readonly monthlyTotal: Money,
    readonly epsApplicable: boolean,
    readonly epsCapApplied: boolean,
    readonly adminChargesAtMinimum: boolean,
    readonly epsNote: string | null = null,
  ) {
    super();
  }

  get amount(): Money {
    return this.monthlyTotal;
  }

  static make(steps: Step[], fields: ConstructorParameters<typeof PfResult>): PfResult {
    return new PfResult(...fields).withWorking(steps);
  }

  explain(): string {
    const wages = this.pfWages.format();
    const rate = rateLabel(this.contributionRate);
    const employee = `Employee ${rate}% × ${wages} = ${this.employeeContribution.format()}`;

    if (!this.epsApplicable) {
      return (
        `${employee}; employer ${rate}% × ${wages} = ${this.employerTotal.format()}, all of it to EPF because ` +
        `${this.epsNote ?? 'the member is outside the Pension Scheme'}`
      );
    }

    return (
      `${employee}; employer ${rate}% × ${wages} = ${this.employerTotal.format()}, split as EPS ` +
      `${this.employerEps.format()} and EPF ${this.employerTotal.format()} − ${this.employerEps.format()} = ` +
      `${this.employerEpf.format()}`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      basic_salary: this.basicSalary.toRupees(),
      basic_salary_formatted: this.basicSalary.format(),
      pf_wages: this.pfWages.toRupees(),
      pf_wages_formatted: this.pfWages.format(),
      wage_ceiling: this.wageCeiling.toRupees(),
      wage_ceiling_formatted: this.wageCeiling.format(),
      restricted_to_ceiling: this.restrictedToCeiling,
      contribution_rate: this.contributionRate,
      employee_contribution: this.employeeContribution.toRupees(),
      employee_contribution_formatted: this.employeeContribution.format(),
      employer_epf: this.employerEpf.toRupees(),
      employer_epf_formatted: this.employerEpf.format(),
      employer_eps: this.employerEps.toRupees(),
      employer_eps_formatted: this.employerEps.format(),
      employer_total: this.employerTotal.toRupees(),
      employer_total_formatted: this.employerTotal.format(),
      edli: this.edli.toRupees(),
      edli_formatted: this.edli.format(),
      admin_charges: this.adminCharges.toRupees(),
      admin_charges_formatted: this.adminCharges.format(),
      total_cost_to_employer: this.totalCostToEmployer.toRupees(),
      total_cost_to_employer_formatted: this.totalCostToEmployer.format(),
      monthly_total: this.monthlyTotal.toRupees(),
      monthly_total_formatted: this.monthlyTotal.format(),
      eps_applicable: this.epsApplicable,
      eps_cap_applied: this.epsCapApplied,
      admin_charges_at_minimum: this.adminChargesAtMinimum,
      eps_note: this.epsNote,
    };
  }
}

/** Monthly EPF, EPS, EDLI and administration charges for one member. */
export class PfCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: PfInput): PfResult {
    const basicSalary = Money.from(input.basicSalary);
    const employerRestrictsToCeiling = input.employerRestrictsToCeiling ?? true;
    const epsEligible = input.epsEligible ?? true;
    const age = input.age ?? null;
    const reducedRate = input.reducedRate ?? false;
    const includeAdminCharges = input.includeAdminCharges ?? true;

    if (basicSalary.isNegative()) {
      throw InvalidInputError.negative('Basic salary');
    }

    if (age !== null && (age < 14 || age > 120)) {
      throw InvalidInputError.outOfRange('Age', 'between 14 and 120', age);
    }

    const table = this.rates.for('epf', input.asOf);
    const citation = table.citation();

    const ceiling = table.money('wage_ceiling');
    const rate = reducedRate ? table.float('reduced_rate') : table.float('employee_rate');

    // Restricting to the ceiling is the employer's choice, not a statutory
    // obligation: para 26A only *permits* contribution limited to ₹15,000.
    // Plenty of establishments contribute on full basic, and the flag is what
    // separates the two payrolls.
    const pfWages = employerRestrictsToCeiling ? basicSalary.min(ceiling) : basicSalary;

    const employee = pfWages.percentage(rate).roundToRupee();
    const employerTotal = pfWages.percentage(rate).roundToRupee();

    const steps: Step[] = [
      new Step({
        label: 'PF wages',
        amount: pfWages,
        formula: employerRestrictsToCeiling
          ? `min(${basicSalary.format()}, ${ceiling.format()})`
          : `${basicSalary.format()} (employer contributes on full basic wages)`,
        citation,
        context: { restricted_to_ceiling: employerRestrictsToCeiling },
      }),
      new Step({
        label: 'Employee contribution',
        amount: employee,
        formula: `${rateLabel(rate)}% × ${pfWages.format()}`,
        citation,
      }),
      new Step({
        label: 'Employer contribution (total)',
        amount: employerTotal,
        formula: `${rateLabel(rate)}% × ${pfWages.format()}`,
        citation,
      }),
    ];

    const pension = this.pensionShare(pfWages, employerTotal, epsEligible, age, table, citation);
    steps.push(pension.step);

    // The EPF side of the employer share is a remainder, never a rate of its
    // own. That is what makes the ₹1,250 cap harmless to the employee: every
    // rupee the Pension Scheme cannot take lands in the provident fund instead,
    // so the employer still parts with the full 12%.
    const employerEpf = employerTotal.subtract(pension.eps).floorAtZero();

    steps.push(
      new Step({
        label: 'Employer share to EPF (A/c 1)',
        amount: employerEpf,
        formula: `${employerTotal.format()} − ${pension.eps.format()}`,
        citation,
      }),
    );

    const edliCeiling = table.money('edli_ceiling_wage');
    const edliRate = table.float('edli_rate');
    const edliMax = table.money('edli_max_contribution');
    const edli = pfWages.min(edliCeiling).percentage(edliRate).min(edliMax).roundToRupee();

    steps.push(
      new Step({
        label: 'EDLI (A/c 21)',
        amount: edli,
        formula: `min(${rateLabel(edliRate)}% × min(${pfWages.format()}, ${edliCeiling.format()}), ${edliMax.format()})`,
        citation,
      }),
    );

    const adminMinimum = table.money('admin_charges_minimum');
    const adminRate = table.float('admin_charges_rate');
    let adminCharges = Money.zero();
    let adminChargesAtMinimum = false;

    if (includeAdminCharges) {
      const computed = pfWages.percentage(adminRate).roundToRupee();
      adminCharges = computed.max(adminMinimum);
      adminChargesAtMinimum =
        adminMinimum.isPositive() && adminCharges.equals(adminMinimum) && computed.lessThan(adminMinimum);

      steps.push(
        new Step({
          label: 'Administration charges (A/c 2)',
          amount: adminCharges,
          formula: `max(${rateLabel(adminRate)}% × ${pfWages.format()}, ${adminMinimum.format()})`,
          citation,
          context: {
            at_minimum: adminChargesAtMinimum,
            // The ₹500 floor is a *per establishment* monthly minimum, not a per
            // employee one. On a single-employee calculation it therefore
            // overstates the charge for every establishment whose whole payroll
            // already clears ₹500 of 0.5% charges.
            minimum_basis: 'per establishment per month',
          },
        }),
      );
    }

    const totalCostToEmployer = employerTotal.add(edli, adminCharges);
    const monthlyTotal = employee.add(totalCostToEmployer);

    steps.push(
      new Step({
        label: 'Total cost to employer',
        amount: totalCostToEmployer,
        formula: `${employerTotal.format()} + ${edli.format()} + ${adminCharges.format()}`,
      }),
      new Step({
        label: 'Total monthly remittance',
        amount: monthlyTotal,
        formula: `${employee.format()} + ${totalCostToEmployer.format()}`,
      }),
    );

    return PfResult.make(steps, [
      basicSalary,
      pfWages,
      ceiling,
      employerRestrictsToCeiling,
      rate,
      employee,
      employerEpf,
      pension.eps,
      employerTotal,
      edli,
      adminCharges,
      totalCostToEmployer,
      monthlyTotal,
      pension.applicable,
      pension.capApplied,
      adminChargesAtMinimum,
      pension.note,
    ]);
  }

  /**
   * The pension slice, and the single most mis-implemented rule in Indian
   * payroll.
   *
   * EPS is 8.33% of wages, but para 3 of the 1995 scheme measures those wages
   * against the statutory ceiling regardless of what the employer chose to
   * contribute on. An employer paying 12% of a ₹30,000 basic still remits only
   * ₹1,250 to the Pension Fund - not 8.33% of ₹30,000, which would be ₹2,499.
   * The cap is on the pension fund's exposure, not on the employer's outgo.
   */
  private pensionShare(
    pfWages: Money,
    employerTotal: Money,
    epsEligible: boolean,
    age: number | null,
    table: RateTable,
    citation: string,
  ): { eps: Money; applicable: boolean; capApplied: boolean; note: string | null; step: Step } {
    const maxAge = table.int('eps_max_age');

    if (!epsEligible || (age !== null && age >= maxAge)) {
      const note = !epsEligible
        ? 'the member is not an EPS member - a first-time member joining on or after ' +
          '01-09-2014 above the wage ceiling is excluded from the Pension Scheme'
        : `the member has attained ${maxAge}, the age at which EPS membership ceases`;

      return {
        eps: Money.zero(),
        applicable: false,
        capApplied: false,
        note,
        step: new Step({
          label: 'Employer share to EPS (A/c 10)',
          amount: Money.zero(),
          formula: `nil - ${note}`,
          citation,
          context: { age: age ?? 0, eps_eligible: epsEligible },
        }),
      };
    }

    const epsCeiling = table.money('eps_ceiling_wage');
    const epsRate = table.float('eps_rate');
    const epsMax = table.money('eps_max_contribution');

    const base = pfWages.min(epsCeiling);
    const uncapped = base.percentage(epsRate);

    // Guard rather than a rule: at 8.33% against a 10% or 12% total this can
    // never bite, but the remainder must not go negative if a future table ever
    // narrows the gap.
    const eps = uncapped.min(epsMax).roundToRupee().min(employerTotal);
    const capApplied = pfWages.greaterThan(epsCeiling) || uncapped.greaterThan(epsMax);

    return {
      eps,
      applicable: true,
      capApplied,
      note: null,
      step: new Step({
        label: 'Employer share to EPS (A/c 10)',
        amount: eps,
        formula: `min(${rateLabel(epsRate)}% × min(${pfWages.format()}, ${epsCeiling.format()}), ${epsMax.format()})`,
        citation,
        context: { cap_applied: capApplied },
      }),
    };
  }
}

/** Monthly EPF, EPS, EDLI and administration charges for one member. */
export function calculatePf(input: PfInput, rates?: RateRepository): PfResult {
  return new PfCalculator(rates).calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/pf` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const pf = calculatePf;
