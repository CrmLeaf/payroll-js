import { type DateInput, daysInMonth as daysInMonthOf, formatDate, toDate } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, rateLabel } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';
import { EsiCalculator, type EsiResult } from './esi.js';
import { PfCalculator, type PfResult } from './pf.js';
import { ProfessionalTaxCalculator, type ProfessionalTaxResult } from './professional-tax.js';
import { TdsCalculator, type TdsResult } from './tds.js';

/**
 * What a wage slip is for, and the reason every line below has to be shown
 * rather than merely computed.
 */
const WAGE_SLIP_CITATION =
  'Payment of Wages Act 1936, section 13A read with the Code on Wages 2019 - ' +
  'the particulars a wage slip must carry';

/**
 * House rent allowance as a percentage of basic. The Income-tax Act does not set
 * the allowance, only the exemption - rule 2A allows up to half of salary in the
 * four metros and 40% elsewhere - so 50% of basic is a house convention rather
 * than a statutory quantity. It matches CtcCalculator's default, which is what
 * lets a payslip reconcile to the offer letter that produced it.
 */
const HRA_PERCENT_OF_BASIC = 50;

const WORD_ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const WORD_TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

const CRORE = 1_00_00_000;
const LAKH = 1_00_000;

export interface PayslipInput {
  employeeName: string;
  /** The full month's gross under the salary structure, before loss of pay. */
  monthlyGross: Money | number | string;
  /** Basic plus dearness allowance, the base for provident fund and HRA. */
  monthlyBasic: Money | number | string;
  /**
   * Any date inside the wage month; its own calendar length is the divisor for
   * loss of pay.
   */
  payMonth: Date | string;
  employeeCode?: string;
  designation?: string;
  /** Days the employee was on the roll in the wage month. */
  daysPayable?: number;
  /** Loss-of-pay days inside those payable days. */
  lopDays?: number;
  /** The state whose professional tax schedule applies. */
  state?: string;
  /**
   * Overrides the rate version; defaults to the wage month, so a slip reissued
   * years later still applies the law that was in force when the wages were
   * earned.
   */
  asOf?: DateInput;
}

export interface PayslipLine {
  label: string;
  amount: number;
  amount_formatted: string;
}

/**
 * One employee's wage slip for one wage month, itemised the way section 13A of
 * the Payment of Wages Act 1936 and the Code on Wages 2019 require it to be.
 *
 * The two arrays that matter are `earningLines()` and `deductionLines()`: a
 * payslip is a table, and the order of its rows is part of what makes it
 * readable. Everything else on the class is either an identity field the slip has
 * to print, a total the rows add to, or the employer's own contributions, which
 * belong on the annexure rather than in the deductions column - they are not the
 * employee's money and never come out of the net.
 */
export class PayslipResult extends Result {
  /**
   * The net pay written out the way a cheque is written, in Indian numbering. A
   * wage slip carries the figure in words as well as in digits so that a disputed
   * amount cannot turn on a misplaced comma.
   */
  readonly netPayInWords: string;

  constructor(
    readonly employeeName: string,
    readonly employeeCode: string,
    readonly designation: string,
    readonly payMonth: Date,
    readonly state: string,
    readonly daysInMonth: number,
    readonly daysPayable: number,
    readonly lopDays: number,
    readonly paidDays: number,
    readonly monthlyGross: Money,
    readonly monthlyBasic: Money,
    readonly basic: Money,
    readonly hra: Money,
    readonly specialAllowance: Money,
    readonly grossEarnings: Money,
    readonly providentFund: Money,
    readonly stateInsurance: Money,
    readonly stateInsuranceApplicable: boolean,
    readonly professionalTax: Money,
    readonly tds: Money,
    readonly totalDeductions: Money,
    readonly netPay: Money,
    readonly employerEpf: Money,
    readonly employerEps: Money,
    readonly employerPf: Money,
    readonly employerEdli: Money,
    readonly employerEsi: Money,
    readonly totalEmployerContributions: Money,
    readonly pfDetail: PfResult,
    readonly esiDetail: EsiResult,
    readonly professionalTaxDetail: ProfessionalTaxResult,
    readonly tdsDetail: TdsResult,
    /**
     * Anything the calculation could not reach or had to adjust, spelled out
     * rather than left implicit.
     */
    readonly notes: string[] = [],
  ) {
    super();
    this.netPayInWords = PayslipResult.amountInWords(netPay);
  }

  get amount(): Money {
    return this.netPay;
  }

  static make(
    steps: Step[],
    citations: string[],
    fields: ConstructorParameters<typeof PayslipResult>,
  ): PayslipResult {
    return new PayslipResult(...fields).withWorking(steps, citations);
  }

  /**
   * The earnings side of the slip, in the order it should be printed.
   *
   * All three lines are always present, including a nil one. A structure that
   * silently drops its special allowance in the month it happens to be zero
   * makes two consecutive payslips look like two different salaries.
   */
  earningLines(): Array<[string, Money]> {
    return [
      ['Basic', this.basic],
      ['House rent allowance', this.hra],
      ['Special allowance', this.specialAllowance],
    ];
  }

  deductionLines(): Array<[string, Money]> {
    const lines: Array<[string, Money]> = [];

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

    return lines;
  }

  /**
   * The employer's own contributions, for the annexure most employers print
   * below the slip. None of these are deducted from the employee.
   */
  employerContributionLines(): Array<[string, Money]> {
    const lines: Array<[string, Money]> = [
      ['Provident fund - EPF (A/c 1)', this.employerEpf],
      ['Provident fund - EPS (A/c 10)', this.employerEps],
      ['EDLI (A/c 21)', this.employerEdli],
    ];

    if (this.stateInsuranceApplicable) {
      lines.push(['ESI (employer share)', this.employerEsi]);
    }

    return lines;
  }

  payMonthLabel(): string {
    return formatDate(this.payMonth, 'F Y');
  }

  explain(): string {
    return (
      `${this.employeeName} (${this.employeeCode}), ${this.payMonthLabel()}: ` +
      `${this.paidDays} of ${this.daysInMonth} days paid; ${this.grossEarnings.format()} earnings − ` +
      `${this.totalDeductions.format()} deductions = ${this.netPay.format()} net (${this.netPayInWords}).`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      employee_name: this.employeeName,
      employee_code: this.employeeCode,
      designation: this.designation,
      pay_month: formatDate(this.payMonth, 'Y-m'),
      pay_month_label: this.payMonthLabel(),
      state: this.state,

      days_in_month: this.daysInMonth,
      days_payable: this.daysPayable,
      lop_days: this.lopDays,
      paid_days: this.paidDays,

      earnings: this.earningLines().map(line),
      deductions: this.deductionLines().map(line),
      employer_contributions: this.employerContributionLines().map(line),

      monthly_gross: this.monthlyGross.toRupees(),
      monthly_gross_formatted: this.monthlyGross.format(),
      monthly_basic: this.monthlyBasic.toRupees(),
      monthly_basic_formatted: this.monthlyBasic.format(),

      basic: this.basic.toRupees(),
      basic_formatted: this.basic.format(),
      hra: this.hra.toRupees(),
      hra_formatted: this.hra.format(),
      special_allowance: this.specialAllowance.toRupees(),
      special_allowance_formatted: this.specialAllowance.format(),
      gross_earnings: this.grossEarnings.toRupees(),
      gross_earnings_formatted: this.grossEarnings.format(),

      provident_fund: this.providentFund.toRupees(),
      provident_fund_formatted: this.providentFund.format(),
      state_insurance: this.stateInsurance.toRupees(),
      state_insurance_formatted: this.stateInsurance.format(),
      state_insurance_applicable: this.stateInsuranceApplicable,
      professional_tax: this.professionalTax.toRupees(),
      professional_tax_formatted: this.professionalTax.format(),
      tds: this.tds.toRupees(),
      tds_formatted: this.tds.format(),
      total_deductions: this.totalDeductions.toRupees(),
      total_deductions_formatted: this.totalDeductions.format(),

      net_pay: this.netPay.toRupees(),
      net_pay_formatted: this.netPay.format(),
      net_pay_in_words: this.netPayInWords,

      employer_epf: this.employerEpf.toRupees(),
      employer_epf_formatted: this.employerEpf.format(),
      employer_eps: this.employerEps.toRupees(),
      employer_eps_formatted: this.employerEps.format(),
      employer_pf: this.employerPf.toRupees(),
      employer_pf_formatted: this.employerPf.format(),
      employer_edli: this.employerEdli.toRupees(),
      employer_edli_formatted: this.employerEdli.format(),
      employer_esi: this.employerEsi.toRupees(),
      employer_esi_formatted: this.employerEsi.format(),
      total_employer_contributions: this.totalEmployerContributions.toRupees(),
      total_employer_contributions_formatted: this.totalEmployerContributions.format(),

      notes: this.notes,
      professional_tax_detail: this.professionalTaxDetail.toArray(),
      tds_detail: this.tdsDetail.toArray(),
    };
  }

  /**
   * An amount in Indian-numbering words: lakh and crore rather than million and
   * billion, and the "and" that a cheque puts before the final pair of digits -
   * "Rupees Forty Two Thousand Three Hundred and Fifty Only".
   *
   * Public and static because it is a pure function of the amount, and a caller
   * printing a covering letter wants it without building a payslip first.
   */
  static amountInWords(amount: Money): string {
    const absolute = Math.abs(amount.paise);
    const rupees = Math.trunc(absolute / 100);
    const paise = absolute % 100;

    let words = `Rupees ${indianWords(rupees)}`;

    if (paise > 0) {
      words += ` and ${indianWords(paise)} Paise`;
    }

    words += ' Only';

    // Heavy loss of pay can leave the deductions larger than the month's
    // earnings, and a slip that prints the recovery as though it were a payment
    // is the one line an employee will dispute.
    return amount.isNegative() ? `Minus ${words}` : words;
  }
}

function indianWords(value: number): string {
  if (value < 100) {
    return belowHundred(value);
  }

  const parts: string[] = [];

  let remaining = value;

  const crore = Math.trunc(remaining / CRORE);
  remaining %= CRORE;

  const lakh = Math.trunc(remaining / LAKH);
  remaining %= LAKH;

  const thousand = Math.trunc(remaining / 1000);
  remaining %= 1000;

  const hundred = Math.trunc(remaining / 100);
  const tail = remaining % 100;

  if (crore > 0) {
    // Recursive rather than capped: above a hundred crore the Indian system
    // keeps grouping in crores ("One Thousand Two Hundred Crore"), and there is
    // no larger unit to reach for.
    parts.push(`${indianWords(crore)} Crore`);
  }

  if (lakh > 0) {
    parts.push(`${belowHundred(lakh)} Lakh`);
  }

  if (thousand > 0) {
    parts.push(`${belowHundred(thousand)} Thousand`);
  }

  if (hundred > 0) {
    parts.push(`${belowHundred(hundred)} Hundred`);
  }

  if (tail > 0) {
    parts.push(`${parts.length === 0 ? '' : 'and '}${belowHundred(tail)}`);
  }

  return parts.join(' ');
}

function belowHundred(value: number): string {
  if (value < 20) {
    return WORD_ONES[value];
  }

  const tens = WORD_TENS[Math.trunc(value / 10)];
  const ones = value % 10;

  return ones === 0 ? tens : `${tens} ${WORD_ONES[ones]}`;
}

function line([label, amount]: [string, Money]): PayslipLine {
  return { label, amount: amount.toRupees(), amount_formatted: amount.format() };
}

/**
 * A wage slip for one employee for one wage month.
 *
 * Section 13A of the Payment of Wages Act 1936 and the Code on Wages 2019 fix
 * what a slip has to carry: who was paid, for which period and how many days of
 * it, the wages under each head, every deduction with its reason, and the net.
 * None of the arithmetic is invented here - provident fund, state insurance,
 * professional tax and tax at source each have their own calculator, and this
 * class decides only what to feed them for a single month.
 *
 * The one piece of judgement it does exercise is loss of pay. A month is divided
 * by its own length rather than by a flat thirty, and the proration is printed as
 * a step of its own, because an employee who loses two days of a 28-day February
 * loses more than two days of a 31-day March and is entitled to see why.
 */
export class PayslipGenerator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: PayslipInput): PayslipResult {
    const employeeName = String(input.employeeName ?? '').trim();
    const payMonth = normalisePayMonth(input.payMonth);
    const monthlyGross = Money.from(input.monthlyGross);
    const monthlyBasic = Money.from(input.monthlyBasic);
    const employeeCode = input.employeeCode ?? 'EMP-0001';
    const designation = input.designation ?? '';
    const state = input.state ?? 'Karnataka';
    const lopDays = input.lopDays ?? 0;

    let daysPayable = input.daysPayable ?? 31;

    validate(employeeName, monthlyGross, monthlyBasic, daysPayable, lopDays);

    const asOf = input.asOf ?? payMonth;
    const notes: string[] = [];

    // The wage month's own length, never a flat thirty. Paying 2/30ths of a
    // February salary for two days of loss of pay short-changes the employee by
    // a fourteenth of the deduction.
    const daysInMonth = daysInMonthOf(payMonth);

    if (daysPayable > daysInMonth) {
      // The form ships a default of 31 because most months have 31 days.
      // Carrying that into February would pay more than a whole month, so it is
      // capped - and said out loud, because a day count nobody typed is exactly
      // the sort of thing that turns into a query.
      notes.push(
        `Days payable was given as ${daysPayable} but ${formatDate(payMonth, 'F Y')} has only ` +
          `${daysInMonth} days, so ${daysInMonth} days were taken as payable.`,
      );

      daysPayable = daysInMonth;
    }

    if (lopDays > daysPayable) {
      throw InvalidInputError.outOfRange(
        'Loss-of-pay days',
        `at most the ${daysPayable} days payable`,
        lopDays,
      );
    }

    const paidDays = daysPayable - lopDays;

    const grossEarnings = monthlyGross.multiply(paidDays).divide(daysInMonth);
    const basic = monthlyBasic.multiply(paidDays).divide(daysInMonth);

    // HRA is taken on the prorated basic and the allowance absorbs the
    // remainder, so the three heads add back to the month's gross to the paise
    // however the rounding falls. An employee checking the arithmetic adds the
    // earnings column first, and it has to agree.
    const hra = basic
      .percentage(HRA_PERCENT_OF_BASIC)
      .min(grossEarnings.subtract(basic).floorAtZero());
    const specialAllowance = grossEarnings.subtract(basic, hra);

    const steps: Step[] = [
      new Step({
        label: `Wage month ${formatDate(payMonth, 'F Y')}`,
        formula:
          `${daysInMonth} days in the month, ${daysPayable} payable, ${lopDays} of loss of pay → ` +
          `${paidDays} paid days`,
        citation: WAGE_SLIP_CITATION,
        context: {
          days_in_month: daysInMonth,
          days_payable: daysPayable,
          lop_days: lopDays,
          paid_days: paidDays,
        },
      }),
      new Step({
        label:
          lopDays > 0
            ? `Gross prorated for ${lopDays} day${lopDays === 1 ? '' : 's'} of loss of pay`
            : 'Gross for the full month',
        amount: grossEarnings,
        formula:
          `(${monthlyGross.format()} × ${paidDays}) ÷ ${daysInMonth}, on the actual length of ` +
          `${formatDate(payMonth, 'F Y')}`,
        citation: WAGE_SLIP_CITATION,
      }),
      new Step({
        label: 'Basic',
        amount: basic,
        formula: `(${monthlyBasic.format()} × ${paidDays}) ÷ ${daysInMonth}`,
      }),
      new Step({
        label: 'House rent allowance',
        amount: hra,
        formula: `${HRA_PERCENT_OF_BASIC}% × ${basic.format()}`,
        context: { basis: 'basic' },
      }),
      new Step({
        label: 'Special allowance (balancing figure)',
        amount: specialAllowance,
        formula: `${grossEarnings.format()} − ${basic.format()} − ${hra.format()}`,
      }),
      new Step({
        label: 'Gross earnings',
        amount: grossEarnings,
        formula: `${basic.format()} + ${hra.format()} + ${specialAllowance.format()}`,
      }),
    ];

    // Administration charges are left out on purpose: the ₹500 floor in the EPF
    // table is a per-establishment monthly minimum, so charging it to one
    // employee's annexure overstates the employer's cost enormously.
    const pf = new PfCalculator(this.rates).calculate({
      basicSalary: basic,
      includeAdminCharges: false,
      asOf,
    });

    steps.push(
      new Step({
        label: 'Provident fund, employee share',
        amount: pf.employeeContribution,
        formula: `${rateLabel(pf.contributionRate)}% × ${pf.pfWages.format()}`,
        citation: pf.citations[0] ?? null,
      }),
    );

    // Coverage is settled on the full monthly wage, the contribution on the
    // wages actually earned. Testing coverage on a prorated figure would drag an
    // employee on ₹25,000 into ESI for the one month they took a fortnight of
    // unpaid leave, and then out again the month after.
    const esiCalculator = new EsiCalculator(this.rates);
    const esiCoverage = esiCalculator.calculate({ grossWages: monthlyGross, asOf });
    const esi = esiCoverage.applicable
      ? esiCalculator.calculate({ grossWages: grossEarnings, asOf })
      : esiCoverage;

    steps.push(
      new Step({
        label: esi.applicable ? 'ESI, employee share' : 'ESI - not applicable',
        amount: esi.employeeContribution,
        formula: esi.applicable
          ? `roundup(${rateLabel(esi.employeeRate)}% × ${grossEarnings.format()})`
          : esiCoverage.reason,
        citation: esi.citations[0] ?? null,
      }),
    );

    const professionalTaxDetail = new ProfessionalTaxCalculator(this.rates).calculate({
      monthlySalary: grossEarnings,
      state,
      month: Number(formatDate(payMonth, 'n')),
      asOf,
    });

    // Most states assess monthly and the month's own levy is what comes off this
    // slip - which is how Maharashtra's ₹300 February lands in February rather
    // than being averaged away. Tamil Nadu, Kerala, Bihar, Jharkhand and
    // Puducherry assess over a half year or a year, and deducting a whole
    // period's levy from one month would be an over-recovery, so a twelfth of the
    // annual liability is taken instead.
    const professionalTax =
      professionalTaxDetail.frequency === 'monthly'
        ? professionalTaxDetail.amountDue
        : professionalTaxDetail.monthlyEquivalent;

    steps.push(
      new Step({
        label: `Professional tax, ${professionalTaxDetail.state}`,
        amount: professionalTax,
        formula:
          professionalTaxDetail.frequency === 'monthly'
            ? professionalTaxDetail.reason
            : `${professionalTaxDetail.state} assesses ` +
              `${professionalTaxDetail.frequency.replace(/_/g, '-')}; one twelfth of the annual ` +
              `${professionalTaxDetail.annualTotal.format()} is deducted this month`,
        citation: professionalTaxDetail.citations[0] ?? null,
      }),
    );

    // Section 192 asks the employer to estimate the whole financial year, so the
    // instalment is a twelfth of the tax on the contracted salary - not on this
    // month's prorated earnings. Annualising a month with loss of pay would
    // under-deduct all year and leave the employee with a bill in March.
    const tdsDetail = new TdsCalculator(this.rates).calculate({ monthlyGross, asOf });

    steps.push(
      new Step({
        label: 'TDS under section 192',
        amount: tdsDetail.monthlyTds,
        formula:
          `annual tax of ${tdsDetail.annualTax.format()} on ${tdsDetail.annualGross.format()} ÷ 12`,
        citation: tdsDetail.citations[0] ?? null,
      }),
    );

    const totalDeductions = pf.employeeContribution.add(
      esi.employeeContribution,
      professionalTax,
      tdsDetail.monthlyTds,
    );

    steps.push(
      new Step({
        label: 'Total deductions',
        amount: totalDeductions,
      }),
    );

    // Not floored. A month of near-total loss of pay can leave the statutory
    // deductions larger than the wages, and the slip has to show the recovery
    // rather than quietly print a zero.
    const netPay = grossEarnings.subtract(totalDeductions);

    if (netPay.isNegative()) {
      notes.push(
        `Deductions of ${totalDeductions.format()} exceed earnings of ${grossEarnings.format()}, so ` +
          `${netPay.multiply(-1).format()} is recoverable rather than payable.`,
      );
    }

    steps.push(
      new Step({
        label: netPay.isNegative() ? 'Net recoverable from the employee' : 'Net pay',
        amount: netPay,
        formula: `${grossEarnings.format()} − ${totalDeductions.format()}`,
        citation: WAGE_SLIP_CITATION,
      }),
      new Step({
        label: 'Net pay in words',
        formula: PayslipResult.amountInWords(netPay),
        citation: WAGE_SLIP_CITATION,
      }),
    );

    const totalEmployerContributions = pf.employerTotal.add(pf.edli, esi.employerContribution);

    notes.push(
      'TDS is estimated under the default new regime on this salary alone, with no investment ' +
        'declaration and nothing already deducted, as a twelfth of the year\'s liability on ' +
        `${tdsDetail.annualGross.format()}.`,
      'The employer contributions are shown for information and are not deducted from the net. ' +
        'PF administration charges are excluded: the minimum is a per-establishment monthly charge, ' +
        'not a per-employee one.',
    );

    return PayslipResult.make(
      steps,
      [
        WAGE_SLIP_CITATION,
        ...pf.citations,
        ...esi.citations,
        ...professionalTaxDetail.citations,
        ...tdsDetail.citations,
      ],
      [
        employeeName,
        employeeCode,
        designation,
        payMonth,
        professionalTaxDetail.state,
        daysInMonth,
        daysPayable,
        lopDays,
        paidDays,
        monthlyGross,
        monthlyBasic,
        basic,
        hra,
        specialAllowance,
        grossEarnings,
        pf.employeeContribution,
        esi.employeeContribution,
        esi.applicable,
        professionalTax,
        tdsDetail.monthlyTds,
        totalDeductions,
        netPay,
        pf.employerEpf,
        pf.employerEps,
        pf.employerTotal,
        pf.edli,
        esi.employerContribution,
        totalEmployerContributions,
        pf,
        esi,
        professionalTaxDetail,
        tdsDetail,
        notes,
      ],
    );
  }
}

function normalisePayMonth(payMonth: Date | string): Date {
  try {
    return toDate(payMonth);
  } catch {
    // A month nobody can parse is a caller bug, not a payroll outcome, and
    // guessing at it would silently pay the wrong wage month.
    throw InvalidInputError.outOfRange('Pay month', 'a parsable date', payMonth);
  }
}

function validate(
  employeeName: string,
  monthlyGross: Money,
  monthlyBasic: Money,
  daysPayable: number,
  lopDays: number,
): void {
  if (employeeName === '') {
    throw InvalidInputError.outOfRange(
      'Employee name',
      'given - section 13A requires the slip to name the person it is issued to',
      '(empty)',
    );
  }

  if (monthlyGross.isNegative()) {
    throw InvalidInputError.negative('Monthly gross');
  }

  if (monthlyBasic.isNegative()) {
    throw InvalidInputError.negative('Monthly basic');
  }

  if (monthlyBasic.greaterThan(monthlyGross)) {
    throw InvalidInputError.outOfRange(
      'Monthly basic',
      'no more than the monthly gross',
      monthlyBasic.format(),
    );
  }

  if (daysPayable < 0) {
    throw InvalidInputError.negative('Days payable');
  }

  if (lopDays < 0) {
    throw InvalidInputError.negative('Loss-of-pay days');
  }
}

/** A wage slip for one employee for one wage month. */
export function calculatePayslip(input: PayslipInput, rates?: RateRepository): PayslipResult {
  return new PayslipGenerator(rates).calculate(input);
}

/**
 * The name the single-tool package `@crmleaf/payslip-generator` re-exports. The
 * arithmetic lives here once, so a rate change cannot land in the suite and miss
 * the standalone package.
 */
export const payslip = calculatePayslip;
