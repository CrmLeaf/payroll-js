import { InvalidInputError } from '../errors.js';
import { Money } from '../money.js';
import { round2 } from './income-tax.js';
import { Result, Step } from '../result.js';

export interface RoiInput {
  employeeCount: number;
  hourlyRate: Money | number | string;
  hoursPerCycleManual: number;
  cyclesPerYear?: number;
  softwareAnnualCost?: Money | number | string | null;
  /** Share of the manual hours automation removes, 0 to 1. */
  automationEfficiency?: number;
  penaltyCostPerYear?: Money | number | string | null;
  errorCostPerYear?: Money | number | string | null;
}

export interface RoiProjectionRow {
  year: number;
  annual_saving: number;
  annual_saving_formatted: string;
  software_cost: number;
  software_cost_formatted: string;
  cumulative_saving: number;
  cumulative_saving_formatted: string;
  cumulative_cost: number;
  cumulative_cost_formatted: string;
  cumulative_net_benefit: number;
  cumulative_net_benefit_formatted: string;
  cumulative_roi_percent: number | null;
}

/** The return on moving a payroll off spreadsheets and onto software. */
export class RoiResult extends Result {
  constructor(
    readonly employeeCount: number,
    readonly hourlyRate: Money,
    readonly hoursPerCycleManual: number,
    readonly cyclesPerYear: number,
    readonly automationEfficiency: number,
    readonly manualAnnualHours: number,
    readonly manualLabourCost: Money,
    readonly hoursSaved: number,
    readonly labourSaving: Money,
    readonly penaltyCostPerYear: Money,
    readonly errorCostPerYear: Money,
    readonly annualSaving: Money,
    readonly softwareAnnualCost: Money,
    readonly netBenefit: Money,
    readonly roiPercent: number | null,
    readonly paybackMonths: number | null,
    readonly annualSavingPerEmployee: Money,
    readonly softwareCostPerEmployee: Money,
    readonly projection: RoiProjectionRow[],
  ) {
    super();
  }

  get amount(): Money {
    return this.netBenefit;
  }

  static withSteps(result: RoiResult, steps: Step[]): RoiResult {
    return result.withWorking(steps);
  }

  isWorthwhile(): boolean {
    return this.netBenefit.isPositive();
  }

  explain(): string {
    return (
      `((${trim(this.hoursPerCycleManual)} hours × ${this.cyclesPerYear} cycles × ` +
      `${trim(this.automationEfficiency * 100)}%) × ${this.hourlyRate.format()}) + ` +
      `${this.penaltyCostPerYear.format()} + ${this.errorCostPerYear.format()} − ` +
      `${this.softwareAnnualCost.format()} = ${this.netBenefit.format()}` +
      (this.roiPercent === null
        ? ' net benefit (ROI undefined - no software cost to return on)'
        : ` net benefit, an ROI of ${trim(this.roiPercent)}%`)
    );
  }

  toArray(): Record<string, unknown> {
    return {
      employee_count: this.employeeCount,
      hourly_rate: this.hourlyRate.toRupees(),
      hourly_rate_formatted: this.hourlyRate.format(),
      hours_per_cycle_manual: this.hoursPerCycleManual,
      cycles_per_year: this.cyclesPerYear,
      automation_efficiency: this.automationEfficiency,
      manual_annual_hours: this.manualAnnualHours,
      manual_labour_cost: this.manualLabourCost.toRupees(),
      manual_labour_cost_formatted: this.manualLabourCost.format(),
      hours_saved: this.hoursSaved,
      labour_saving: this.labourSaving.toRupees(),
      labour_saving_formatted: this.labourSaving.format(),
      penalty_cost_per_year: this.penaltyCostPerYear.toRupees(),
      penalty_cost_per_year_formatted: this.penaltyCostPerYear.format(),
      error_cost_per_year: this.errorCostPerYear.toRupees(),
      error_cost_per_year_formatted: this.errorCostPerYear.format(),
      annual_saving: this.annualSaving.toRupees(),
      annual_saving_formatted: this.annualSaving.format(),
      software_annual_cost: this.softwareAnnualCost.toRupees(),
      software_annual_cost_formatted: this.softwareAnnualCost.format(),
      net_benefit: this.netBenefit.toRupees(),
      net_benefit_formatted: this.netBenefit.format(),
      roi_percent: this.roiPercent,
      payback_months: this.paybackMonths,
      annual_saving_per_employee: this.annualSavingPerEmployee.toRupees(),
      annual_saving_per_employee_formatted: this.annualSavingPerEmployee.format(),
      software_cost_per_employee: this.softwareCostPerEmployee.toRupees(),
      software_cost_per_employee_formatted: this.softwareCostPerEmployee.format(),
      worthwhile: this.isWorthwhile(),
      projection: this.projection,
    };
  }
}

/**
 * The return on moving a payroll off spreadsheets and onto software.
 *
 * Pure business arithmetic - no statute, no rate table, and therefore no `asOf`.
 * The one thing this must not do is flatter the answer: every figure traces back
 * to an assumption the caller supplied, the efficiency is capped at 100% because
 * automation cannot save more time than the task takes, and an ROI with no cost to
 * divide by is reported as undefined rather than as infinity dressed up in a
 * percentage sign.
 */
export class RoiCalculator {
  calculate(input: RoiInput): RoiResult {
    const { employeeCount, hoursPerCycleManual } = input;
    const hourlyRate = Money.from(input.hourlyRate);
    const cyclesPerYear = input.cyclesPerYear ?? 12;
    const automationEfficiency = input.automationEfficiency ?? 0.8;

    if (employeeCount < 1) {
      throw InvalidInputError.outOfRange('employeeCount', 'at least 1', employeeCount);
    }

    if (cyclesPerYear < 1) {
      throw InvalidInputError.outOfRange('cyclesPerYear', 'at least 1', cyclesPerYear);
    }

    if (automationEfficiency < 0 || automationEfficiency > 1) {
      throw InvalidInputError.outOfRange('automationEfficiency', 'between 0 and 1', automationEfficiency);
    }

    if (hoursPerCycleManual < 0) {
      throw InvalidInputError.negative('hoursPerCycleManual');
    }

    if (hourlyRate.isNegative()) {
      throw InvalidInputError.negative('hourlyRate');
    }

    const software = nonNegative(input.softwareAnnualCost, 'softwareAnnualCost');
    const penalty = nonNegative(input.penaltyCostPerYear, 'penaltyCostPerYear');
    const errors = nonNegative(input.errorCostPerYear, 'errorCostPerYear');

    const manualAnnualHours = hoursPerCycleManual * cyclesPerYear;
    const manualLabourCost = hourlyRate.multiply(manualAnnualHours);

    const hoursSaved = manualAnnualHours * automationEfficiency;
    const labourSaving = hourlyRate.multiply(hoursSaved);

    const annualSaving = labourSaving.add(penalty, errors);
    const netBenefit = annualSaving.subtract(software);

    // With no licence fee there is no investment to return on. Reporting
    // "infinite ROI" would be arithmetically true and commercially useless, so the
    // ratio is null and the net benefit carries the story instead.
    const roiPercent = software.isZero() ? null : round2((netBenefit.paise / software.paise) * 100);

    const paybackMonths = paybackMonthsFor(software, annualSaving);

    const result = new RoiResult(
      employeeCount,
      hourlyRate,
      hoursPerCycleManual,
      cyclesPerYear,
      automationEfficiency,
      manualAnnualHours,
      manualLabourCost,
      hoursSaved,
      labourSaving,
      penalty,
      errors,
      annualSaving,
      software,
      netBenefit,
      roiPercent,
      paybackMonths,
      annualSaving.divide(employeeCount),
      software.divide(employeeCount),
      projectionFor(annualSaving, software, 3),
    );

    return RoiResult.withSteps(result, [
      new Step({
        label: 'Manual effort per year',
        formula: `${trim(hoursPerCycleManual)} hours × ${cyclesPerYear} cycles = ${trim(manualAnnualHours)} hours`,
        context: { hours: manualAnnualHours },
      }),
      new Step({
        label: 'Cost of that effort',
        amount: manualLabourCost,
        formula: `${trim(manualAnnualHours)} hours × ${hourlyRate.format()}`,
      }),
      new Step({
        label: 'Hours automation removes',
        formula:
          `${trim(manualAnnualHours)} hours × ${trim(automationEfficiency * 100)}% = ` +
          `${trim(hoursSaved)} hours`,
        context: { hours: hoursSaved },
      }),
      new Step({
        label: 'Labour saving',
        amount: labourSaving,
        formula: `${trim(hoursSaved)} hours × ${hourlyRate.format()}`,
      }),
      new Step({
        label: 'Avoided penalties and error corrections',
        amount: penalty.add(errors),
        formula: `${penalty.format()} + ${errors.format()}`,
      }),
      new Step({
        label: 'Total annual saving',
        amount: annualSaving,
        formula: `${labourSaving.format()} + ${penalty.format()} + ${errors.format()}`,
      }),
      new Step({
        label: 'Net benefit after software cost',
        amount: netBenefit,
        formula: `${annualSaving.format()} − ${software.format()}`,
      }),
      new Step({
        label: 'Return on investment',
        formula:
          roiPercent === null
            ? 'undefined - no software cost was supplied'
            : `${netBenefit.format()} ÷ ${software.format()} × 100 = ${trim(roiPercent)}%`,
      }),
      new Step({
        label: 'Payback period',
        formula:
          paybackMonths === null
            ? 'never - the automation saves nothing at these assumptions'
            : `${software.format()} ÷ (${annualSaving.format()} ÷ 12) = ${trim(paybackMonths)} months`,
      }),
    ]);
  }
}

/**
 * Months of saving needed to recover a year's licence fee. Undefined when nothing
 * is saved: dividing by a zero or negative saving would produce a number that
 * looks like a schedule and is not one.
 */
function paybackMonthsFor(software: Money, annualSaving: Money): number | null {
  if (!annualSaving.isPositive()) return null;
  if (software.isZero()) return 0;

  return round2((software.paise * 12) / annualSaving.paise);
}

/**
 * A three-year view. Deliberately linear - no price escalation, no growing
 * efficiency, no headcount growth. Any of those would be a guess, and a guess
 * compounded three times is a fabrication.
 */
function projectionFor(annualSaving: Money, software: Money, years: number): RoiProjectionRow[] {
  const rows: RoiProjectionRow[] = [];
  let cumulativeSaving = Money.zero();
  let cumulativeCost = Money.zero();

  for (let year = 1; year <= years; year += 1) {
    cumulativeSaving = cumulativeSaving.add(annualSaving);
    cumulativeCost = cumulativeCost.add(software);
    const cumulativeNet = cumulativeSaving.subtract(cumulativeCost);

    rows.push({
      year,
      annual_saving: annualSaving.toRupees(),
      annual_saving_formatted: annualSaving.format(),
      software_cost: software.toRupees(),
      software_cost_formatted: software.format(),
      cumulative_saving: cumulativeSaving.toRupees(),
      cumulative_saving_formatted: cumulativeSaving.format(),
      cumulative_cost: cumulativeCost.toRupees(),
      cumulative_cost_formatted: cumulativeCost.format(),
      cumulative_net_benefit: cumulativeNet.toRupees(),
      cumulative_net_benefit_formatted: cumulativeNet.format(),
      cumulative_roi_percent: cumulativeCost.isZero()
        ? null
        : round2((cumulativeNet.paise / cumulativeCost.paise) * 100),
    });
  }

  return rows;
}

function nonNegative(amount: Money | number | string | null | undefined, field: string): Money {
  const value = amount === null || amount === undefined ? Money.zero() : Money.from(amount);

  if (value.isNegative()) {
    throw InvalidInputError.negative(field);
  }

  return value;
}

function trim(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** The return on moving a payroll off spreadsheets and onto software. */
export function calculateRoi(input: RoiInput): RoiResult {
  return new RoiCalculator().calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/roi` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const roi = calculateRoi;
