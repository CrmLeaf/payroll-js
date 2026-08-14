import { InvalidInputError } from '../errors.js';
import { Money } from '../money.js';
import { round2 } from './income-tax.js';
import { Result, Step } from '../result.js';

/**
 * Multiples of the current headcount used for the sensitivity table. A buyer
 * wants to know whether the saving survives the next hiring round, and where the
 * per-employee rate crosses over the flat fee.
 */
const SENSITIVITY_FACTORS = [0.5, 1.0, 2.0, 5.0];

export interface SavingsInput {
  employeeCount: number;
  currentPerEmployeePerMonth: Money | number | string;
  proposedPerEmployeePerMonth: Money | number | string;
  currentAnnualPlatformFee?: Money | number | string | null;
  proposedAnnualPlatformFee?: Money | number | string | null;
  migrationCost?: Money | number | string | null;
  contractMonths?: number;
}

export interface SensitivityRow {
  factor: number;
  employee_count: number;
  current_annual_total: number;
  current_annual_total_formatted: string;
  proposed_annual_total: number;
  proposed_annual_total_formatted: string;
  annual_saving: number;
  annual_saving_formatted: string;
  saving_percent: number | null;
  proposal_costs_more: boolean;
}

/** Annual cost of the incumbent payroll provider against a proposed one. */
export class SavingsResult extends Result {
  constructor(
    readonly employeeCount: number,
    readonly contractMonths: number,
    readonly currentPerEmployeePerMonth: Money,
    readonly proposedPerEmployeePerMonth: Money,
    readonly currentAnnualPlatformFee: Money,
    readonly proposedAnnualPlatformFee: Money,
    readonly currentAnnualTotal: Money,
    readonly proposedAnnualTotal: Money,
    readonly annualSaving: Money,
    readonly savingPercent: number | null,
    readonly perEmployeeAnnualSaving: Money,
    readonly migrationCost: Money,
    readonly firstYearSaving: Money,
    readonly breakEvenMonths: number | null,
    readonly contractTermSaving: Money,
    readonly proposalCostsMore: boolean,
    readonly sensitivity: SensitivityRow[],
  ) {
    super();
  }

  get amount(): Money {
    return this.annualSaving;
  }

  static withSteps(result: SavingsResult, steps: Step[]): SavingsResult {
    return result.withWorking(steps);
  }

  explain(): string {
    return (
      `(${this.currentPerEmployeePerMonth.format()} × ${this.employeeCount} × 12 + ` +
      `${this.currentAnnualPlatformFee.format()}) − (${this.proposedPerEmployeePerMonth.format()} × ` +
      `${this.employeeCount} × 12 + ${this.proposedAnnualPlatformFee.format()}) = ` +
      `${this.annualSaving.format()} a year` +
      (this.proposalCostsMore
        ? ' - the proposal costs more, not less'
        : this.savingPercent === null
          ? ''
          : `, a saving of ${trim(this.savingPercent)}%`)
    );
  }

  toArray(): Record<string, unknown> {
    return {
      employee_count: this.employeeCount,
      contract_months: this.contractMonths,
      current_per_employee_per_month: this.currentPerEmployeePerMonth.toRupees(),
      current_per_employee_per_month_formatted: this.currentPerEmployeePerMonth.format(),
      proposed_per_employee_per_month: this.proposedPerEmployeePerMonth.toRupees(),
      proposed_per_employee_per_month_formatted: this.proposedPerEmployeePerMonth.format(),
      current_annual_platform_fee: this.currentAnnualPlatformFee.toRupees(),
      current_annual_platform_fee_formatted: this.currentAnnualPlatformFee.format(),
      proposed_annual_platform_fee: this.proposedAnnualPlatformFee.toRupees(),
      proposed_annual_platform_fee_formatted: this.proposedAnnualPlatformFee.format(),
      current_annual_total: this.currentAnnualTotal.toRupees(),
      current_annual_total_formatted: this.currentAnnualTotal.format(),
      proposed_annual_total: this.proposedAnnualTotal.toRupees(),
      proposed_annual_total_formatted: this.proposedAnnualTotal.format(),
      annual_saving: this.annualSaving.toRupees(),
      annual_saving_formatted: this.annualSaving.format(),
      saving_percent: this.savingPercent,
      per_employee_annual_saving: this.perEmployeeAnnualSaving.toRupees(),
      per_employee_annual_saving_formatted: this.perEmployeeAnnualSaving.format(),
      migration_cost: this.migrationCost.toRupees(),
      migration_cost_formatted: this.migrationCost.format(),
      first_year_saving: this.firstYearSaving.toRupees(),
      first_year_saving_formatted: this.firstYearSaving.format(),
      break_even_months: this.breakEvenMonths,
      contract_term_saving: this.contractTermSaving.toRupees(),
      contract_term_saving_formatted: this.contractTermSaving.format(),
      proposal_costs_more: this.proposalCostsMore,
      sensitivity: this.sensitivity,
    };
  }
}

/**
 * Annual cost of the incumbent payroll provider against a proposed one.
 *
 * Both sides are priced the same way - a per-employee-per-month rate plus a flat
 * platform fee - because that is how nearly every Indian payroll vendor quotes,
 * and comparing a PEPM headline without the platform fee is how buyers get
 * caught. No statute is involved, so there is no rate table and no `asOf`.
 */
export class SavingsCalculator {
  calculate(input: SavingsInput): SavingsResult {
    const { employeeCount } = input;
    const contractMonths = input.contractMonths ?? 12;
    const currentPerEmployeePerMonth = Money.from(input.currentPerEmployeePerMonth);
    const proposedPerEmployeePerMonth = Money.from(input.proposedPerEmployeePerMonth);

    if (employeeCount < 1) {
      throw InvalidInputError.outOfRange('employeeCount', 'at least 1', employeeCount);
    }

    if (contractMonths < 1) {
      throw InvalidInputError.outOfRange('contractMonths', 'at least 1', contractMonths);
    }

    assertNotNegative(currentPerEmployeePerMonth, 'currentPerEmployeePerMonth');
    assertNotNegative(proposedPerEmployeePerMonth, 'proposedPerEmployeePerMonth');

    const currentFee = nonNegative(input.currentAnnualPlatformFee, 'currentAnnualPlatformFee');
    const proposedFee = nonNegative(input.proposedAnnualPlatformFee, 'proposedAnnualPlatformFee');
    const migration = nonNegative(input.migrationCost, 'migrationCost');

    const currentTotal = annualTotal(currentPerEmployeePerMonth, employeeCount, currentFee);
    const proposedTotal = annualTotal(proposedPerEmployeePerMonth, employeeCount, proposedFee);

    const annualSaving = currentTotal.subtract(proposedTotal);

    // Not floored at zero: a proposal that costs more is a real answer, and the
    // honest one. The caller gets the sign and a flag, not a nought.
    const savingPercent = currentTotal.isZero()
      ? null
      : round2((annualSaving.paise / currentTotal.paise) * 100);

    const firstYearSaving = annualSaving.subtract(migration);
    const contractTermSaving = annualSaving.multiply(contractMonths / 12).subtract(migration);
    const breakEvenMonths = breakEvenMonthsFor(migration, annualSaving);

    const result = new SavingsResult(
      employeeCount,
      contractMonths,
      currentPerEmployeePerMonth,
      proposedPerEmployeePerMonth,
      currentFee,
      proposedFee,
      currentTotal,
      proposedTotal,
      annualSaving,
      savingPercent,
      annualSaving.divide(employeeCount),
      migration,
      firstYearSaving,
      breakEvenMonths,
      contractTermSaving,
      annualSaving.isNegative(),
      sensitivityFor(employeeCount, currentPerEmployeePerMonth, proposedPerEmployeePerMonth, currentFee, proposedFee),
    );

    return SavingsResult.withSteps(result, [
      new Step({
        label: 'Current annual cost',
        amount: currentTotal,
        formula: `${currentPerEmployeePerMonth.format()} × ${employeeCount} × 12 + ${currentFee.format()}`,
      }),
      new Step({
        label: 'Proposed annual cost',
        amount: proposedTotal,
        formula: `${proposedPerEmployeePerMonth.format()} × ${employeeCount} × 12 + ${proposedFee.format()}`,
      }),
      new Step({
        label: annualSaving.isNegative() ? 'Additional annual cost' : 'Annual saving',
        amount: annualSaving,
        formula: `${currentTotal.format()} − ${proposedTotal.format()}`,
      }),
      new Step({
        label: 'Saving per employee per year',
        amount: annualSaving.divide(employeeCount),
        formula: `${annualSaving.format()} ÷ ${employeeCount}`,
      }),
      new Step({
        label: 'First year, net of migration',
        amount: firstYearSaving,
        formula: `${annualSaving.format()} − ${migration.format()}`,
      }),
      new Step({
        label: 'Break-even on the migration cost',
        formula:
          breakEvenMonths === null
            ? 'never - the proposal does not save anything to recover it with'
            : `${migration.format()} ÷ (${annualSaving.format()} ÷ 12) = ${trim(breakEvenMonths)} months`,
      }),
      new Step({
        label: `Saving over the ${contractMonths}-month term`,
        amount: contractTermSaving,
        formula: `${annualSaving.format()} × ${contractMonths} ÷ 12 − ${migration.format()}`,
      }),
    ]);
  }
}

function annualTotal(perEmployeePerMonth: Money, employeeCount: number, platformFee: Money): Money {
  return perEmployeePerMonth.multiply(employeeCount).multiply(12).add(platformFee);
}

function breakEvenMonthsFor(migration: Money, annualSaving: Money): number | null {
  // No saving means no stream of money to recover the migration from, so there is
  // no break-even month - not month zero.
  if (!annualSaving.isPositive()) return null;
  if (migration.isZero()) return 0;

  return round2((migration.paise * 12) / annualSaving.paise);
}

/**
 * How the annual saving scales with headcount. The platform fee does not move
 * with headcount, so the shape of this table is what tells a buyer whether they
 * are paying for the fee or for the seats.
 */
function sensitivityFor(
  employeeCount: number,
  current: Money,
  proposed: Money,
  currentFee: Money,
  proposedFee: Money,
): SensitivityRow[] {
  return SENSITIVITY_FACTORS.map((factor) => {
    const headcount = Math.max(1, phpRoundInt(employeeCount * factor));

    const currentTotal = annualTotal(current, headcount, currentFee);
    const proposedTotal = annualTotal(proposed, headcount, proposedFee);
    const saving = currentTotal.subtract(proposedTotal);

    return {
      factor,
      employee_count: headcount,
      current_annual_total: currentTotal.toRupees(),
      current_annual_total_formatted: currentTotal.format(),
      proposed_annual_total: proposedTotal.toRupees(),
      proposed_annual_total_formatted: proposedTotal.format(),
      annual_saving: saving.toRupees(),
      annual_saving_formatted: saving.format(),
      saving_percent: currentTotal.isZero() ? null : round2((saving.paise / currentTotal.paise) * 100),
      proposal_costs_more: saving.isNegative(),
    };
  });
}

function phpRoundInt(value: number): number {
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

function assertNotNegative(amount: Money, field: string): void {
  if (amount.isNegative()) {
    throw InvalidInputError.negative(field);
  }
}

function nonNegative(amount: Money | number | string | null | undefined, field: string): Money {
  const value = amount === null || amount === undefined ? Money.zero() : Money.from(amount);
  assertNotNegative(value, field);
  return value;
}

function trim(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Annual cost of the incumbent payroll provider against a proposed one. */
export function calculateSavings(input: SavingsInput): SavingsResult {
  return new SavingsCalculator().calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/savings` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const savings = calculateSavings;
