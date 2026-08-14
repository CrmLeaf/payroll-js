import {
  type DateInput,
  addDays,
  daysInMonth,
  diffYearsMonthsDays,
  financialYearOf,
  formatDate,
  month as monthOf,
  toDate,
} from '../dates.js';
import { InvalidInputError, RateNotFoundError } from '../errors.js';
import { Money } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';
import { EsiCalculator } from './esi.js';
import { GratuityCalculator, type GratuityResult } from './gratuity.js';
import { IncomeTaxCalculator } from './income-tax.js';
import { LeaveEncashmentCalculator, type LeaveEncashmentResult } from './leave-encashment.js';
import { PfCalculator } from './pf.js';
import { ProfessionalTaxCalculator } from './professional-tax.js';

/**
 * Mirrors the reasons the gratuity calculator accepts, because the reason drives
 * two decisions here - whether the five-year qualifying period is waived, and
 * whether notice pay is recoverable at all.
 */
const SEPARATION_REASONS = [
  'resignation',
  'retirement',
  'superannuation',
  'termination',
  'retrenchment',
  'death',
  'disablement',
];

/**
 * Reasons on which no notice-period shortfall is recovered. Notice is a
 * contractual undertaking to work, and an estate is in no position to have broken
 * one.
 */
const NOTICE_WAIVED_ON = ['death', 'disablement'];

/**
 * Notice pay is a contractual figure, and the contract almost always expresses it
 * as a month of thirty days rather than as the calendar month the employee
 * happens to be leaving in.
 */
const NOTICE_DAYS_IN_MONTH = 30;

export interface FnfInput {
  /** Full monthly gross, the base for the final month's salary and ESI. */
  monthlyGross: Money | number | string;
  /** Basic plus DA, the base for gratuity, leave encashment, PF and notice pay. */
  monthlyBasic: Money | number | string;
  joiningDate: Date | string;
  lastWorkingDate: Date | string;
  /** Loss-of-pay days inside the final month. */
  unpaidDays?: number;
  /** Earned leave standing to the employee's credit at separation. */
  leaveDaysBalance?: number;
  noticePeriodDays?: number;
  noticeDaysServed?: number;
  /** Pending incentive, bonus, arrears - taxable in full. */
  otherEarnings?: Money | number | string | null;
  /** Asset, loan and advance recoveries agreed with the employee. */
  recoveries?: Money | number | string | null;
  separationReason?: string;
  covered?: boolean;
  state?: string;
  /**
   * Overrides the rate version; defaults to the last working date, so a
   * settlement revised months later still applies the law in force at separation.
   */
  asOf?: DateInput;
}

export interface FnfLine {
  label: string;
  amount: number;
  amount_formatted: string;
}

/**
 * Full and final settlement on separation: what the employee is owed, what the
 * employer is entitled to recover, and the difference between them.
 */
export class FnfResult extends Result {
  constructor(
    readonly monthlyGross: Money,
    readonly monthlyBasic: Money,
    readonly joiningDate: Date,
    readonly lastWorkingDate: Date,
    readonly separationReason: string,
    readonly covered: boolean,
    readonly state: string,
    readonly serviceYears: number,
    readonly serviceMonths: number,
    readonly serviceDays: number,
    readonly daysInFinalMonth: number,
    readonly daysWorked: number,
    readonly unpaidDays: number,
    readonly salaryForDaysWorked: Money,
    readonly leaveEncashment: Money,
    readonly leaveEncashmentExempt: Money,
    readonly leaveEncashmentTaxable: Money,
    readonly gratuity: Money,
    readonly gratuityExempt: Money,
    readonly gratuityTaxable: Money,
    readonly gratuityEligible: boolean,
    readonly gratuityIneligibilityReason: string | null,
    readonly otherEarnings: Money,
    readonly grossEarnings: Money,
    readonly noticeShortfallDays: number,
    readonly noticePayRecovery: Money,
    readonly providentFund: Money,
    readonly stateInsurance: Money,
    readonly stateInsuranceApplicable: boolean,
    readonly professionalTax: Money,
    readonly tds: Money,
    readonly recoveries: Money,
    readonly totalDeductions: Money,
    readonly netPayable: Money,
    readonly employeeOwesCompany: boolean,
    readonly taxableEarnings: Money,
    readonly exemptEarnings: Money,
    readonly tdsBasis: string,
    readonly gratuityDetail: GratuityResult,
    readonly leaveEncashmentDetail: LeaveEncashmentResult,
    readonly notes: string[],
    steps: Step[],
  ) {
    super();
    this.withWorking(steps);
  }

  get amount(): Money {
    return this.netPayable;
  }

  earningLines(): Array<[string, Money]> {
    const lines: Array<[string, Money]> = [
      [
        `Salary for ${this.daysWorked} of ${this.daysInFinalMonth} days in ` +
          `${formatDate(this.lastWorkingDate, 'F Y')}`,
        this.salaryForDaysWorked,
      ],
    ];

    if (this.leaveEncashment.isPositive()) {
      lines.push([
        `Leave encashment (${this.leaveEncashmentDetail.leaveDaysEncashed} days)`,
        this.leaveEncashment,
      ]);
    }

    if (this.gratuity.isPositive()) {
      lines.push([`Gratuity (${this.gratuityDetail.completedYears} completed years)`, this.gratuity]);
    }

    if (this.otherEarnings.isPositive()) {
      lines.push(['Other earnings', this.otherEarnings]);
    }

    return lines;
  }

  deductionLines(): Array<[string, Money]> {
    const lines: Array<[string, Money]> = [];

    if (this.noticePayRecovery.isPositive()) {
      lines.push([`Notice pay recovery (${this.noticeShortfallDays} days short)`, this.noticePayRecovery]);
    }

    if (this.providentFund.isPositive()) {
      lines.push(['Provident fund (employee share)', this.providentFund]);
    }

    if (this.stateInsurance.isPositive()) {
      lines.push(['ESI (employee share)', this.stateInsurance]);
    }

    if (this.professionalTax.isPositive()) {
      lines.push([`Professional tax (${this.state})`, this.professionalTax]);
    }

    if (this.tds.isPositive()) {
      lines.push(['TDS under section 192', this.tds]);
    }

    if (this.recoveries.isPositive()) {
      lines.push(['Other recoveries', this.recoveries]);
    }

    return lines;
  }

  explain(): string {
    return (
      `${this.grossEarnings.format()} earnings − ${this.totalDeductions.format()} deductions = ` +
      `${this.netPayable.format()} ` +
      `${this.employeeOwesCompany ? 'recoverable from the employee' : 'payable to the employee'}.`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      monthly_gross: this.monthlyGross.toRupees(),
      monthly_gross_formatted: this.monthlyGross.format(),
      monthly_basic: this.monthlyBasic.toRupees(),
      monthly_basic_formatted: this.monthlyBasic.format(),
      joining_date: formatDate(this.joiningDate, 'Y-m-d'),
      last_working_date: formatDate(this.lastWorkingDate, 'Y-m-d'),
      separation_reason: this.separationReason,
      covered: this.covered,
      state: this.state,
      service_years: this.serviceYears,
      service_months: this.serviceMonths,
      service_days: this.serviceDays,
      days_in_final_month: this.daysInFinalMonth,
      days_worked: this.daysWorked,
      unpaid_days: this.unpaidDays,
      earnings: this.earningLines().map(line),
      deductions: this.deductionLines().map(line),
      salary_for_days_worked: this.salaryForDaysWorked.toRupees(),
      salary_for_days_worked_formatted: this.salaryForDaysWorked.format(),
      leave_encashment: this.leaveEncashment.toRupees(),
      leave_encashment_formatted: this.leaveEncashment.format(),
      leave_encashment_exempt: this.leaveEncashmentExempt.toRupees(),
      leave_encashment_taxable: this.leaveEncashmentTaxable.toRupees(),
      gratuity: this.gratuity.toRupees(),
      gratuity_formatted: this.gratuity.format(),
      gratuity_exempt: this.gratuityExempt.toRupees(),
      gratuity_taxable: this.gratuityTaxable.toRupees(),
      gratuity_eligible: this.gratuityEligible,
      gratuity_ineligibility_reason: this.gratuityIneligibilityReason,
      other_earnings: this.otherEarnings.toRupees(),
      other_earnings_formatted: this.otherEarnings.format(),
      gross_earnings: this.grossEarnings.toRupees(),
      gross_earnings_formatted: this.grossEarnings.format(),
      notice_shortfall_days: this.noticeShortfallDays,
      notice_pay_recovery: this.noticePayRecovery.toRupees(),
      notice_pay_recovery_formatted: this.noticePayRecovery.format(),
      provident_fund: this.providentFund.toRupees(),
      provident_fund_formatted: this.providentFund.format(),
      state_insurance: this.stateInsurance.toRupees(),
      state_insurance_formatted: this.stateInsurance.format(),
      state_insurance_applicable: this.stateInsuranceApplicable,
      professional_tax: this.professionalTax.toRupees(),
      professional_tax_formatted: this.professionalTax.format(),
      tds: this.tds.toRupees(),
      tds_formatted: this.tds.format(),
      tds_basis: this.tdsBasis,
      recoveries: this.recoveries.toRupees(),
      recoveries_formatted: this.recoveries.format(),
      total_deductions: this.totalDeductions.toRupees(),
      total_deductions_formatted: this.totalDeductions.format(),
      net_payable: this.netPayable.toRupees(),
      net_payable_formatted: this.netPayable.format(),
      employee_owes_company: this.employeeOwesCompany,
      taxable_earnings: this.taxableEarnings.toRupees(),
      exempt_earnings: this.exemptEarnings.toRupees(),
      notes: this.notes,
      gratuity_detail: this.gratuityDetail.toArray(),
      leave_encashment_detail: this.leaveEncashmentDetail.toArray(),
    };
  }
}

function line([label, amount]: [string, Money]): FnfLine {
  return { label, amount: amount.toRupees(), amount_formatted: amount.format() };
}

/**
 * Full and final settlement on separation.
 *
 * This is the one calculator in the suite that composes others rather than
 * implementing a statute of its own. Gratuity, leave encashment, provident fund,
 * ESI, professional tax and the slab arithmetic all live in their own classes;
 * the work here is deciding what to feed each of them at separation, which is
 * where most F&F statements go wrong.
 */
export class FnfCalculator {
  private readonly gratuityCalculator: GratuityCalculator;
  private readonly leaveEncashmentCalculator: LeaveEncashmentCalculator;
  private readonly pfCalculator: PfCalculator;
  private readonly esiCalculator: EsiCalculator;
  private readonly professionalTaxCalculator: ProfessionalTaxCalculator;
  private readonly incomeTaxCalculator: IncomeTaxCalculator;

  constructor(private readonly rates: RateRepository = defaultRates) {
    this.gratuityCalculator = new GratuityCalculator(rates);
    this.leaveEncashmentCalculator = new LeaveEncashmentCalculator(rates);
    this.pfCalculator = new PfCalculator(rates);
    this.esiCalculator = new EsiCalculator(rates);
    this.professionalTaxCalculator = new ProfessionalTaxCalculator(rates);
    this.incomeTaxCalculator = new IncomeTaxCalculator(rates);
  }

  calculate(input: FnfInput): FnfResult {
    const monthlyGross = Money.from(input.monthlyGross);
    const monthlyBasic = Money.from(input.monthlyBasic);
    const joiningDate = toDate(input.joiningDate);
    const lastWorkingDate = toDate(input.lastWorkingDate);
    const unpaidDays = input.unpaidDays ?? 0;
    const leaveDaysBalance = input.leaveDaysBalance ?? 0;
    const noticePeriodDays = input.noticePeriodDays ?? 0;
    const noticeDaysServed = input.noticeDaysServed ?? 0;
    const covered = input.covered ?? true;
    const state = input.state ?? 'Karnataka';

    const otherEarnings =
      input.otherEarnings === null || input.otherEarnings === undefined
        ? Money.zero()
        : Money.from(input.otherEarnings);
    const recoveries =
      input.recoveries === null || input.recoveries === undefined ? Money.zero() : Money.from(input.recoveries);

    const reason = this.validate(
      monthlyGross,
      monthlyBasic,
      joiningDate,
      lastWorkingDate,
      unpaidDays,
      leaveDaysBalance,
      noticePeriodDays,
      noticeDaysServed,
      otherEarnings,
      recoveries,
      input.separationReason ?? 'resignation',
    );

    const asOf: DateInput = input.asOf ?? lastWorkingDate;

    // Service is counted inclusive of the last working day. Somebody who joins on
    // 1 January 2020 and works to 31 December 2024 has completed five years; a
    // plain diff of those two dates returns four years eleven months and thirty
    // days and would deny them gratuity.
    const span = diffYearsMonthsDays(joiningDate, addDays(lastWorkingDate, 1));
    const serviceYears = span.years;
    const serviceMonths = span.months;
    const serviceDays = span.days;

    // The Act rounds a part year up when the excess is *more than* six months, so
    // the residual days matter: six months and one day rounds up, six months
    // exactly does not. Carrying the days into the month count reproduces that
    // with no special case at the boundary. It is capped at eleven rather than
    // allowed to roll into a year, because the qualifying period runs on completed
    // years and eleven months and a day is not five years of continuous service.
    const gratuityMonths = Math.min(11, serviceMonths + (serviceDays > 0 ? 1 : 0));

    const daysInFinalMonth = daysInMonth(lastWorkingDate);
    const daysWorked = daysOnRoll(joiningDate, lastWorkingDate) - unpaidDays;

    if (daysWorked < 0) {
      throw InvalidInputError.outOfRange(
        'Unpaid days',
        `at most the ${daysWorked + unpaidDays} days on roll in the final month`,
        unpaidDays,
      );
    }

    // The final month is divided by its own length, not by a flat thirty. Twenty
    // days of a 28-day February is a larger share of the salary than twenty days
    // of a 31-day March, and paying both the same is a real deduction the employee
    // can point at.
    const salaryForDaysWorked = monthlyGross.multiply(daysWorked).divide(daysInFinalMonth);
    const basicForDaysWorked = monthlyBasic.multiply(daysWorked).divide(daysInFinalMonth);

    const steps: Step[] = [
      new Step({
        label: 'Service',
        formula:
          `${formatDate(joiningDate, 'd-m-Y')} → ${formatDate(lastWorkingDate, 'd-m-Y')} = ${serviceYears} years ` +
          `${serviceMonths} months ${serviceDays} days (last working day counted)`,
        context: { years: serviceYears, months: serviceMonths, days: serviceDays },
      }),
      new Step({
        label: `Salary for ${daysWorked} of ${daysInFinalMonth} days worked`,
        amount: salaryForDaysWorked,
        formula:
          `(${monthlyGross.format()} × ${daysWorked}) ÷ ${daysInFinalMonth}, on the actual length of ` +
          `${formatDate(lastWorkingDate, 'F Y')}`,
        context: { days_worked: daysWorked, unpaid_days: unpaidDays },
      }),
    ];

    const leave = this.leaveEncashmentCalculator.calculate({
      averageMonthlySalary: monthlyBasic,
      leaveDaysEncashed: leaveDaysBalance,
      yearsOfService: serviceYears,
      asOf,
    });

    steps.push(
      new Step({
        label: `Leave encashment for ${leaveDaysBalance} days`,
        amount: leave.encashment,
        formula: leave.explain(),
        citation: leave.citations[0] ?? null,
      }),
    );

    const gratuity = this.gratuityCalculator.calculate({
      lastDrawnSalary: monthlyBasic,
      yearsOfService: serviceYears,
      monthsOfService: gratuityMonths,
      covered,
      separationReason: reason,
      asOf,
    });

    steps.push(
      new Step({
        label: gratuity.eligible ? 'Gratuity' : 'Gratuity - not payable',
        amount: gratuity.gratuity,
        formula: gratuity.explain(),
        citation: gratuity.citations[0] ?? null,
        context: { eligible: gratuity.eligible },
      }),
    );

    if (otherEarnings.isPositive()) {
      steps.push(new Step({ label: 'Other earnings', amount: otherEarnings }));
    }

    const grossEarnings = salaryForDaysWorked.add(leave.encashment, gratuity.gratuity, otherEarnings);

    steps.push(
      new Step({
        label: 'Gross earnings',
        amount: grossEarnings,
        formula:
          `${salaryForDaysWorked.format()} + ${leave.encashment.format()} + ${gratuity.gratuity.format()} + ` +
          `${otherEarnings.format()}`,
      }),
    );

    const notice = noticeRecovery(monthlyBasic, noticePeriodDays, noticeDaysServed, reason);
    if (notice.step !== null) {
      steps.push(notice.step);
    }

    const pf = this.pfCalculator.calculate({ basicSalary: basicForDaysWorked, asOf });

    steps.push(
      new Step({
        label: 'Provident fund, employee share',
        amount: pf.employeeContribution,
        formula: `${pf.contributionRate}% × ${pf.pfWages.format()}`,
        citation: pf.citations[0] ?? null,
      }),
    );

    // Coverage is settled on the full monthly wage but the contribution is charged
    // on the wages actually paid. Testing coverage on the pro-rated figure would
    // drag an employee earning ₹25,000 a month into ESI simply because they left
    // on the eighth.
    const esiCoverage = this.esiCalculator.calculate({ grossWages: monthlyGross, asOf });
    const esi = esiCoverage.applicable
      ? this.esiCalculator.calculate({ grossWages: salaryForDaysWorked, asOf })
      : esiCoverage;

    steps.push(
      new Step({
        label: esi.applicable ? 'ESI, employee share' : 'ESI - not applicable',
        amount: esi.employeeContribution,
        formula: esi.applicable
          ? `roundup(${esi.employeeRate}% × ${salaryForDaysWorked.format()})`
          : esiCoverage.reason,
        citation: esi.citations[0] ?? null,
      }),
    );

    const notes: string[] = [];
    let professionalTaxDue = Money.zero();

    try {
      const professionalTax = this.professionalTaxCalculator.calculate({
        monthlySalary: salaryForDaysWorked,
        state,
        month: monthOf(lastWorkingDate),
        asOf,
      });

      // Most states assess monthly and the month's own levy is the figure to
      // deduct. Tamil Nadu, Kerala, Puducherry, Bihar and Jharkhand assess over a
      // half year or a year, and dropping a whole half-year's levy on a settlement
      // would be an over-recovery, so one month's share of the annual liability
      // comes off instead.
      professionalTaxDue =
        professionalTax.frequency === 'monthly' ? professionalTax.amountDue : professionalTax.monthlyEquivalent;

      steps.push(
        new Step({
          label: `Professional tax, ${state}`,
          amount: professionalTaxDue,
          formula:
            professionalTax.frequency === 'monthly'
              ? professionalTax.reason
              : `${state} assesses ${professionalTax.frequency.replace(/_/g, '-')}; one month of the annual ` +
                `${professionalTax.annualTotal.format()} is recovered in the settlement`,
          citation: professionalTax.citations[0] ?? null,
        }),
      );
    } catch (error) {
      if (!(error instanceof RateNotFoundError)) throw error;

      // The gratuity and leave tables reach back two decades; the state
      // professional tax schedules do not. A recomputation of an old settlement is
      // still worth producing, with the line it could not reach flagged rather
      // than guessed at.
      notes.push(
        `Professional tax not computed: no schedule for ${state} on ` +
          `${formatDate(lastWorkingDate, 'd-m-Y')}. ${error.message}`,
      );

      steps.push(
        new Step({
          label: `Professional tax, ${state} - not computed`,
          amount: Money.zero(),
          formula: `no schedule in the rate tables for ${formatDate(lastWorkingDate, 'F Y')}`,
        }),
      );
    }

    // The exempt slices of gratuity and leave encashment never enter the TDS base
    // - that is the entire point of section 10(10) and 10(10AA).
    const taxableEarnings = salaryForDaysWorked.add(otherEarnings, gratuity.taxable, leave.taxable);
    const exemptEarnings = gratuity.taxExempt.add(leave.exemption);

    const tdsResult = this.tds(monthlyGross, taxableEarnings, lastWorkingDate, asOf);
    steps.push(tdsResult.step);

    if (tdsResult.note !== null) {
      notes.push(tdsResult.note);
    }

    if (recoveries.isPositive()) {
      steps.push(new Step({ label: 'Other recoveries', amount: recoveries }));
    }

    const totalDeductions = notice.recovery.add(
      pf.employeeContribution,
      esi.employeeContribution,
      professionalTaxDue,
      tdsResult.tds,
      recoveries,
    );

    steps.push(new Step({ label: 'Total deductions', amount: totalDeductions }));

    // Not floored. A resignation with no notice served can leave the employee
    // owing the employer, and the statement has to say so.
    const netPayable = grossEarnings.subtract(totalDeductions);

    steps.push(
      new Step({
        label: netPayable.isNegative() ? 'Net recoverable from the employee' : 'Net payable to the employee',
        amount: netPayable,
        formula: `${grossEarnings.format()} − ${totalDeductions.format()}`,
      }),
    );

    return new FnfResult(
      monthlyGross,
      monthlyBasic,
      joiningDate,
      lastWorkingDate,
      reason,
      covered,
      state,
      serviceYears,
      serviceMonths,
      serviceDays,
      daysInFinalMonth,
      daysWorked,
      unpaidDays,
      salaryForDaysWorked,
      leave.encashment,
      leave.exemption,
      leave.taxable,
      gratuity.gratuity,
      gratuity.taxExempt,
      gratuity.taxable,
      gratuity.eligible,
      gratuity.ineligibilityReason,
      otherEarnings,
      grossEarnings,
      notice.shortfallDays,
      notice.recovery,
      pf.employeeContribution,
      esi.employeeContribution,
      esi.applicable,
      professionalTaxDue,
      tdsResult.tds,
      recoveries,
      totalDeductions,
      netPayable,
      netPayable.isNegative(),
      taxableEarnings,
      exemptEarnings,
      tdsResult.basis,
      gratuity,
      leave,
      notes,
      steps,
    );
  }

  /**
   * Tax deductible on the settlement, taken as the tax the taxable components add
   * to the year's salary income.
   *
   * Section 192 obliges the employer to deduct on the estimated income of the
   * whole financial year, and at separation the only part of that year still to be
   * taxed is what the settlement pays out. So the settlement's TDS is the
   * difference between the tax on the salary already drawn this year and the tax
   * on that salary plus the taxable settlement - which is what makes the exempt
   * gratuity and leave encashment genuinely free of tax rather than merely
   * reported as exempt.
   */
  private tds(
    monthlyGross: Money,
    taxableEarnings: Money,
    lastWorkingDate: Date,
    asOf: DateInput,
  ): { tds: Money; basis: string; step: Step; note: string | null } {
    // Whole months of the financial year completed before the exit month.
    const monthsAlreadyPaid = (monthOf(lastWorkingDate) - 4 + 12) % 12;
    const salaryAlreadyPaid = monthlyGross.multiply(monthsAlreadyPaid);

    let withoutSettlement: Money;
    let withSettlement: Money;

    try {
      withoutSettlement = this.incomeTaxCalculator.calculate({ grossSalary: salaryAlreadyPaid, asOf }).totalTax;
      withSettlement = this.incomeTaxCalculator.calculate({
        grossSalary: salaryAlreadyPaid.add(taxableEarnings),
        asOf,
      }).totalTax;
    } catch (error) {
      if (!(error instanceof RateNotFoundError)) throw error;

      const note =
        `TDS not computed: no slab table for ${financialYearOf(lastWorkingDate)}. ${error.message}`;

      return {
        tds: Money.zero(),
        basis: note,
        step: new Step({
          label: 'TDS under section 192 - not computed',
          amount: Money.zero(),
          formula: `no slab table for ${financialYearOf(lastWorkingDate)}`,
        }),
        note,
      };
    }

    const tds = withSettlement.subtract(withoutSettlement).floorAtZero().roundToRupee();

    const basis =
      `Marginal tax on the taxable settlement of ${taxableEarnings.format()}, over salary of ` +
      `${salaryAlreadyPaid.format()} already drawn in ${financialYearOf(lastWorkingDate)}, under the default ` +
      'new regime with no declared deductions.';

    return {
      tds,
      basis,
      step: new Step({
        label: 'TDS under section 192',
        amount: tds,
        formula: `tax(${salaryAlreadyPaid.add(taxableEarnings).format()}) − tax(${salaryAlreadyPaid.format()})`,
        citation: this.rates.for('income-tax', asOf).citation(),
        context: {
          taxable_settlement: taxableEarnings.toRupees(),
          months_already_paid: monthsAlreadyPaid,
        },
      }),
      note: null,
    };
  }

  private validate(
    monthlyGross: Money,
    monthlyBasic: Money,
    joiningDate: Date,
    lastWorkingDate: Date,
    unpaidDays: number,
    leaveDaysBalance: number,
    noticePeriodDays: number,
    noticeDaysServed: number,
    otherEarnings: Money,
    recoveries: Money,
    separationReason: string,
  ): string {
    if (monthlyGross.isNegative()) throw InvalidInputError.negative('Monthly gross');
    if (monthlyBasic.isNegative()) throw InvalidInputError.negative('Monthly basic');

    if (monthlyBasic.greaterThan(monthlyGross)) {
      throw InvalidInputError.outOfRange('Monthly basic', 'no more than the monthly gross', monthlyBasic.format());
    }

    if (lastWorkingDate < joiningDate) {
      throw InvalidInputError.outOfRange(
        'Last working date',
        'on or after the joining date',
        formatDate(lastWorkingDate, 'Y-m-d'),
      );
    }

    if (unpaidDays < 0) throw InvalidInputError.negative('Unpaid days');
    if (leaveDaysBalance < 0) throw InvalidInputError.negative('Leave days balance');
    if (noticePeriodDays < 0) throw InvalidInputError.negative('Notice period days');
    if (noticeDaysServed < 0) throw InvalidInputError.negative('Notice days served');
    if (otherEarnings.isNegative()) throw InvalidInputError.negative('Other earnings');
    if (recoveries.isNegative()) throw InvalidInputError.negative('Recoveries');

    const reason = separationReason.trim().toLowerCase();

    if (!SEPARATION_REASONS.includes(reason)) {
      throw InvalidInputError.unknownOption('separation reason', separationReason, SEPARATION_REASONS);
    }

    return reason;
  }
}

/**
 * Days the employee was on the payroll in the final month, before loss of pay.
 * Somebody who joined and left inside the same month is only on roll from the
 * joining date.
 */
function daysOnRoll(joiningDate: Date, lastWorkingDate: Date): number {
  const lastDay = lastWorkingDate.getUTCDate();

  if (formatDate(joiningDate, 'Y-m') !== formatDate(lastWorkingDate, 'Y-m')) {
    return lastDay;
  }

  return lastDay - joiningDate.getUTCDate() + 1;
}

function noticeRecovery(
  monthlyBasic: Money,
  noticePeriodDays: number,
  noticeDaysServed: number,
  reason: string,
): { shortfallDays: number; recovery: Money; step: Step | null } {
  const shortfall = Math.max(0, noticePeriodDays - noticeDaysServed);

  if (shortfall > 0 && NOTICE_WAIVED_ON.includes(reason)) {
    return {
      shortfallDays: 0,
      recovery: Money.zero(),
      step: new Step({
        label: `Notice pay not recovered on ${reason}`,
        amount: Money.zero(),
        formula: `${shortfall} days short, waived`,
      }),
    };
  }

  if (shortfall === 0) {
    return { shortfallDays: 0, recovery: Money.zero(), step: null };
  }

  const recovery = monthlyBasic.multiply(shortfall).divide(NOTICE_DAYS_IN_MONTH);

  return {
    shortfallDays: shortfall,
    recovery,
    step: new Step({
      label: `Notice pay recovery, ${shortfall} days short of ${noticePeriodDays}`,
      amount: recovery,
      formula: `(${monthlyBasic.format()} ÷ ${NOTICE_DAYS_IN_MONTH}) × ${shortfall}`,
      context: { notice_period_days: noticePeriodDays, notice_days_served: noticeDaysServed },
    }),
  };
}

/** Full and final settlement on separation. */
export function calculateFnf(input: FnfInput, rates?: RateRepository): FnfResult {
  return new FnfCalculator(rates).calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/fnf` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const fnf = calculateFnf;
