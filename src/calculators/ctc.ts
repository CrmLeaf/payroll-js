import type { DateInput } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, rateLabel } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';
import { BonusCalculator, type BonusResult } from './bonus.js';
import { EsiCalculator, type EsiResult } from './esi.js';
import { PfCalculator, type PfResult } from './pf.js';
import { ProfessionalTaxCalculator, type ProfessionalTaxResult } from './professional-tax.js';
import { TdsCalculator, type TdsResult } from './tds.js';

/**
 * The gratuity accrual an employer provides for each month: fifteen days' basic
 * for each year of service, spread over the twelve months that earn it. The ÷26
 * is the Payment of Gratuity Act's own divisor for a covered establishment, not a
 * working-days approximation.
 */
const GRATUITY_DAYS = 15;
const GRATUITY_DIVISOR = 26;

/**
 * Earned leave accrues at roughly fifteen days a year under the Factories Act and
 * most shops and establishments Acts, and encashment during service is settled at
 * a thirtieth of monthly salary a day. Both are conventions rather than statutory
 * quantities for a *provision*, which is why they are constants here and not
 * rate-table values.
 */
const LEAVE_DAYS_PER_YEAR = 15;
const LEAVE_DAY_DIVISOR = 30;

/**
 * Employer ESI is a percentage of a gross that ESI itself reduces, so the two
 * have to settle on each other. The iteration contracts by a factor of 0.0325 a
 * pass and converges in two or three; eight is a ceiling, not an expectation.
 */
const ESI_SETTLING_PASSES = 8;

const REGIMES = ['new', 'old'];

export interface CtcInput {
  annualCtc: Money | number | string;
  state?: string;
  basicPercent?: number;
  hraPercent?: number;
  includeBonus?: boolean;
  includeLeaveEncashment?: boolean;
  employerPfRestrictedToCeiling?: boolean;
  regime?: string;
  asOf?: DateInput;
}

export interface CtcRow {
  label: string;
  monthly: number;
  monthly_formatted: string;
  annual: number;
  annual_formatted: string;
  total: boolean;
}

/**
 * A cost-to-company broken into the components an offer letter actually lists.
 *
 * Every figure here is monthly; the annual column is that figure times twelve.
 * Special allowance is the balancing item, which is what makes the whole thing
 * add up: basic and HRA come off percentages, the employer's contributions come
 * off statute, and whatever is left of the CTC becomes allowance. That is how
 * real salary structures are built, and it is why raising the basic percentage
 * does not raise the CTC - it only moves money between lines.
 */
export class CtcResult extends Result {
  constructor(
    readonly annualCtc: Money,
    readonly monthlyCtc: Money,
    readonly basicPercent: number,
    readonly hraPercent: number,
    readonly state: string,
    readonly regime: string,
    readonly basic: Money,
    readonly hra: Money,
    readonly specialAllowance: Money,
    readonly grossSalary: Money,
    readonly bonus: Money,
    readonly leaveEncashment: Money,
    readonly employerPf: Money,
    readonly employerEpf: Money,
    readonly employerEps: Money,
    readonly employerEsi: Money,
    readonly gratuityProvision: Money,
    readonly totalEmployerContributions: Money,
    readonly employeePf: Money,
    readonly employeeEsi: Money,
    readonly professionalTax: Money,
    readonly tds: Money,
    readonly totalDeductions: Money,
    readonly netInHand: Money,
    readonly pf: PfResult,
    readonly esi: EsiResult,
    readonly professionalTaxDetail: ProfessionalTaxResult,
    readonly tdsDetail: TdsResult,
    readonly bonusDetail: BonusResult | null,
    readonly assumptions: string[],
  ) {
    super();
  }

  get amount(): Money {
    return this.netInHand;
  }

  static withSteps(result: CtcResult, steps: Step[], citations: string[] = []): CtcResult {
    return result.withWorking(steps, citations);
  }

  /**
   * Bonus and leave encashment fall due once a year rather than on the monthly
   * payslip, so they sit inside the CTC but outside the gross.
   */
  annualPayouts(): Money {
    return this.bonus.add(this.leaveEncashment);
  }

  annualGrossSalary(): Money {
    return this.grossSalary.multiply(12);
  }

  annualNetInHand(): Money {
    return this.netInHand.multiply(12);
  }

  /**
   * The CTC as the components actually reconstruct it. Identical to `monthlyCtc`
   * to the paise - the assertion lives in the test suite, and this method is what
   * a caller uses to prove it for themselves.
   */
  reconciledMonthlyCtc(): Money {
    return this.grossSalary.add(this.bonus, this.leaveEncashment, this.totalEmployerContributions);
  }

  explain(): string {
    return (
      `${this.annualCtc.format()} ÷ 12 = ${this.monthlyCtc.format()} a month; basic ` +
      `${rateLabel(this.basicPercent)}% = ${this.basic.format()}, HRA ${rateLabel(this.hraPercent)}% of basic = ` +
      `${this.hra.format()}; ${this.monthlyCtc.format()} − ${this.employerPf.format()} employer PF − ` +
      `${this.employerEsi.format()} employer ESI − ${this.gratuityProvision.format()} gratuity` +
      `${this.annualPayouts().isZero() ? '' : ` − ${this.annualPayouts().format()} bonus and leave provisions`}` +
      ` = ${this.grossSalary.format()} gross, so special allowance = ${this.grossSalary.format()} − ` +
      `${this.basic.format()} − ${this.hra.format()} = ${this.specialAllowance.format()}; net in hand ` +
      `${this.grossSalary.format()} − ${this.totalDeductions.format()} deductions = ${this.netInHand.format()}`
    );
  }

  toArray(): Record<string, unknown> {
    const earnings: CtcRow[] = [
      row('Basic', this.basic),
      row('House rent allowance', this.hra),
      row('Special allowance', this.specialAllowance),
      row('Gross salary', this.grossSalary, true),
    ];

    if (this.bonus.isPositive() || this.bonusDetail !== null) {
      earnings.push(row('Statutory bonus (provision)', this.bonus));
    }

    if (this.leaveEncashment.isPositive()) {
      earnings.push(row('Leave encashment (provision)', this.leaveEncashment));
    }

    return {
      annual_ctc: this.annualCtc.toRupees(),
      annual_ctc_formatted: this.annualCtc.format(),
      monthly_ctc: this.monthlyCtc.toRupees(),
      monthly_ctc_formatted: this.monthlyCtc.format(),
      state: this.state,
      regime: this.regime,
      basic_percent: this.basicPercent,
      hra_percent: this.hraPercent,

      earnings,
      deductions: [
        row('Provident fund (employee)', this.employeePf),
        row('ESI (employee)', this.employeeEsi),
        row('Professional tax', this.professionalTax),
        row('TDS', this.tds),
        row('Total deductions', this.totalDeductions, true),
      ],
      employer_contributions: [
        row('Provident fund - EPF (A/c 1)', this.employerEpf),
        row('Provident fund - EPS (A/c 10)', this.employerEps),
        row('ESI (employer)', this.employerEsi),
        row('Gratuity provision', this.gratuityProvision),
        row('Total employer contributions', this.totalEmployerContributions, true),
      ],
      summary: [
        row('Gross salary', this.grossSalary),
        row('Total deductions', this.totalDeductions),
        row('Net in hand', this.netInHand, true),
        row('Cost to company', this.monthlyCtc, true),
      ],

      gross_salary: this.grossSalary.toRupees(),
      gross_salary_formatted: this.grossSalary.format(),
      net_in_hand: this.netInHand.toRupees(),
      net_in_hand_formatted: this.netInHand.format(),
      annual_net_in_hand: this.annualNetInHand().toRupees(),
      annual_net_in_hand_formatted: this.annualNetInHand().format(),
      total_deductions: this.totalDeductions.toRupees(),
      total_deductions_formatted: this.totalDeductions.format(),
      total_employer_contributions: this.totalEmployerContributions.toRupees(),
      total_employer_contributions_formatted: this.totalEmployerContributions.format(),

      professional_tax_annual: this.professionalTaxDetail.annualTotal.toRupees(),
      professional_tax_annual_formatted: this.professionalTaxDetail.annualTotal.format(),
      annual_income_tax: this.tdsDetail.annualTax.toRupees(),
      annual_income_tax_formatted: this.tdsDetail.annualTax.format(),
      esi_applicable: this.esi.applicable,
      bonus_eligible: this.bonusDetail?.eligible ?? null,

      assumptions: this.assumptions,
    };
  }
}

function row(label: string, amount: Money, total = false): CtcRow {
  const annual = amount.multiply(12);

  return {
    label,
    monthly: amount.toRupees(),
    monthly_formatted: amount.format(),
    annual: annual.toRupees(),
    annual_formatted: annual.format(),
    total,
  };
}

/**
 * A cost-to-company broken into the components an offer letter lists.
 *
 * The structure is built backwards from the CTC rather than forwards from the
 * gross, because CTC is the number that gets negotiated. Basic and HRA come off
 * percentages, the employer's statutory costs come off the PF, ESI and gratuity
 * rules, and special allowance absorbs whatever is left. Only that ordering makes
 * the components add back to the agreed CTC to the paise, which is the one
 * property an employee will check.
 */
export class CtcCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: CtcInput): CtcResult {
    const annualCtc = Money.from(input.annualCtc);
    const state = input.state ?? 'Karnataka';
    const basicPercent = input.basicPercent ?? 40;
    const hraPercent = input.hraPercent ?? 50;
    const includeBonus = input.includeBonus ?? false;
    const includeLeaveEncashment = input.includeLeaveEncashment ?? false;
    const employerPfRestrictedToCeiling = input.employerPfRestrictedToCeiling ?? true;
    const asOf = input.asOf;

    if (annualCtc.isNegative()) {
      throw InvalidInputError.negative('Annual CTC');
    }

    if (basicPercent <= 0 || basicPercent > 100) {
      throw InvalidInputError.outOfRange('Basic percent', 'above 0 and at most 100', basicPercent);
    }

    if (hraPercent < 0 || hraPercent > 100) {
      throw InvalidInputError.outOfRange('HRA percent', 'between 0 and 100', hraPercent);
    }

    const regime = String(input.regime ?? 'new').trim().toLowerCase();

    if (!REGIMES.includes(regime)) {
      throw InvalidInputError.unknownOption('regime', regime, REGIMES);
    }

    const monthlyCtc = annualCtc.divide(12);
    const basic = monthlyCtc.percentage(basicPercent);
    const hra = basic.percentage(hraPercent);

    // Administration charges are excluded deliberately. The ₹500 floor in the EPF
    // table is a per-establishment monthly minimum, so charging it to one
    // employee's CTC overstates the cost by an order of magnitude on any payroll
    // bigger than a handful of people.
    const pf = new PfCalculator(this.rates).calculate({
      basicSalary: basic,
      employerRestrictsToCeiling: employerPfRestrictedToCeiling,
      includeAdminCharges: false,
      asOf,
    });

    const gratuityProvision = basic.multiply(GRATUITY_DAYS).divide(GRATUITY_DIVISOR).divide(12);

    let bonusDetail: BonusResult | null = null;
    let bonus = Money.zero();

    if (includeBonus) {
      // Statutory bonus is computed on basic wages, and an employee above the
      // ₹21,000 eligibility limit earns none at all. That is not an error - the
      // CTC simply has no bonus line, and the result says so.
      bonusDetail = new BonusCalculator(this.rates).calculate({ monthlyWages: basic, asOf });
      bonus = bonusDetail.monthlyBonus;
    }

    const leaveEncashment = includeLeaveEncashment
      ? basic.multiply(LEAVE_DAYS_PER_YEAR).divide(LEAVE_DAY_DIVISOR).divide(12)
      : Money.zero();

    const grossBeforeEsi = monthlyCtc.subtract(pf.employerTotal, gratuityProvision, bonus, leaveEncashment);

    const [gross, esi] = this.settleEmployerEsi(grossBeforeEsi, asOf);

    if (gross.isNegative()) {
      throw InvalidInputError.outOfRange(
        'Annual CTC',
        `large enough to carry the employer contributions it implies - ${monthlyCtc.format()} a month leaves ` +
          `nothing after ${pf.employerTotal.format()} of employer PF and ${gratuityProvision.format()} of ` +
          'gratuity provision. Raise the CTC or lower the basic percentage',
        annualCtc.format(),
      );
    }

    const specialAllowance = gross.subtract(basic, hra);

    if (specialAllowance.isNegative()) {
      throw InvalidInputError.outOfRange(
        'Basic percent and HRA percent',
        `small enough that basic and HRA fit inside the gross - basic of ${basic.format()} plus HRA of ` +
          `${hra.format()} exceeds the gross of ${gross.format()} by ${specialAllowance.multiply(-1).format()}, ` +
          'leaving no special allowance. Lower the basic percentage, lower the HRA percentage, or raise the CTC',
        `${rateLabel(basicPercent)}% and ${rateLabel(hraPercent)}%`,
      );
    }

    const professionalTaxDetail = new ProfessionalTaxCalculator(this.rates).calculate({
      monthlySalary: gross,
      state,
      asOf,
    });

    // The state's own period may be half-yearly or annual, and Maharashtra
    // charges a different amount in February. A CTC breakdown wants one number
    // every month, so it takes the annual levy spread over twelve.
    const professionalTax = professionalTaxDetail.monthlyEquivalent;

    // Section 192 asks the employer to estimate the whole year, so bonus and leave
    // encashment are taxed even though they are not paid monthly.
    const taxableMonthly = gross.add(bonus, leaveEncashment);

    // The employee's own provident fund contribution is a certainty rather than a
    // declaration, so it is claimed under 80C without being asked for. The new
    // regime refuses it, which is the right answer there.
    const tdsDetail = new TdsCalculator(this.rates).calculate({
      monthlyGross: taxableMonthly,
      regime,
      deductions: { '80c': pf.employeeContribution.multiply(12) },
      asOf,
    });

    const employeePf = pf.employeeContribution;
    const employeeEsi = esi.employeeContribution;
    const tds = tdsDetail.monthlyTds;

    const totalDeductions = employeePf.add(employeeEsi, professionalTax, tds);
    const netInHand = gross.subtract(totalDeductions);
    const totalEmployerContributions = pf.employerTotal.add(esi.employerContribution, gratuityProvision);

    const result = new CtcResult(
      annualCtc,
      monthlyCtc,
      basicPercent,
      hraPercent,
      professionalTaxDetail.state,
      regime,
      basic,
      hra,
      specialAllowance,
      gross,
      bonus,
      leaveEncashment,
      pf.employerTotal,
      pf.employerEpf,
      pf.employerEps,
      esi.employerContribution,
      gratuityProvision,
      totalEmployerContributions,
      employeePf,
      employeeEsi,
      professionalTax,
      tds,
      totalDeductions,
      netInHand,
      pf,
      esi,
      professionalTaxDetail,
      tdsDetail,
      bonusDetail,
      this.assumptions(
        annualCtc,
        monthlyCtc,
        includeBonus,
        includeLeaveEncashment,
        employerPfRestrictedToCeiling,
        regime,
      ),
    );

    return CtcResult.withSteps(
      result,
      this.steps(
        monthlyCtc,
        basic,
        basicPercent,
        hra,
        hraPercent,
        pf.employerTotal,
        esi,
        gratuityProvision,
        bonus,
        leaveEncashment,
        gross,
        specialAllowance,
        totalDeductions,
        netInHand,
        professionalTax,
        tds,
        pf.employeeContribution,
        asOf,
      ),
      [
        ...pf.citations,
        ...esi.citations,
        ...professionalTaxDetail.citations,
        ...tdsDetail.citations,
      ],
    );
  }

  /**
   * Gross and employer ESI are mutually defined: ESI is 3.25% of the gross, and
   * the gross is what is left of the CTC after ESI. Solving that by iteration
   * rather than algebra keeps the rupee-up rounding that rule 51 demands, which a
   * closed form would quietly lose.
   */
  private settleEmployerEsi(grossBeforeEsi: Money, asOf: DateInput): [Money, EsiResult] {
    const calculator = new EsiCalculator(this.rates);
    let gross = grossBeforeEsi;
    let esi = calculator.calculate({ grossWages: gross.floorAtZero(), asOf });

    for (let pass = 0; pass < ESI_SETTLING_PASSES; pass += 1) {
      esi = calculator.calculate({ grossWages: gross.floorAtZero(), asOf });
      const settled = grossBeforeEsi.subtract(esi.employerContribution);

      if (settled.equals(gross)) {
        return [gross, esi];
      }

      gross = settled;
    }

    // A wage sitting exactly on a rounding boundary can oscillate by a rupee
    // rather than settle. The CTC identity still holds to the paise, because the
    // gross is *defined* as the balance after the contribution - only the
    // contribution itself may be a rupee off 3.25% of the final gross.
    return [gross, esi];
  }

  private steps(
    monthlyCtc: Money,
    basic: Money,
    basicPercent: number,
    hra: Money,
    hraPercent: number,
    pfEmployer: Money,
    esi: EsiResult,
    gratuityProvision: Money,
    bonus: Money,
    leaveEncashment: Money,
    gross: Money,
    specialAllowance: Money,
    totalDeductions: Money,
    netInHand: Money,
    professionalTax: Money,
    tds: Money,
    employeePf: Money,
    asOf: DateInput,
  ): Step[] {
    const epf = this.rates.for('epf', asOf);
    const gratuity = this.rates.for('gratuity', asOf);

    const steps: Step[] = [
      new Step({
        label: 'Monthly cost to company',
        amount: monthlyCtc,
        formula: `${monthlyCtc.multiply(12).format()} ÷ 12`,
      }),
      new Step({
        label: 'Basic',
        amount: basic,
        formula: `${rateLabel(basicPercent)}% × ${monthlyCtc.format()}`,
        context: { basis: 'monthly CTC' },
      }),
      new Step({
        label: 'House rent allowance',
        amount: hra,
        formula: `${rateLabel(hraPercent)}% × ${basic.format()}`,
        context: { basis: 'basic' },
      }),
      new Step({
        label: 'Employer provident fund',
        amount: pfEmployer,
        formula: `12% of PF wages of ${basic.format()}`,
        citation: epf.citation(),
      }),
      new Step({
        label: 'Employer ESI',
        amount: esi.employerContribution,
        formula: esi.applicable
          ? `roundup(${rateLabel(esi.employerRate)}% × ${gross.format()})`
          : `nil - gross of ${gross.format()} exceeds the ${esi.wageLimit.format()} wage limit`,
        citation: esi.citations[0] ?? null,
      }),
      new Step({
        label: 'Gratuity provision',
        amount: gratuityProvision,
        formula: `(${basic.format()} × ${GRATUITY_DAYS} ÷ ${GRATUITY_DIVISOR}) ÷ 12`,
        citation: gratuity.citation(),
      }),
    ];

    if (bonus.isPositive()) {
      steps.push(
        new Step({
          label: 'Statutory bonus provision',
          amount: bonus,
          formula: `one twelfth of the annual bonus on basic wages of ${basic.format()}`,
        }),
      );
    }

    if (leaveEncashment.isPositive()) {
      steps.push(
        new Step({
          label: 'Leave encashment provision',
          amount: leaveEncashment,
          formula: `(${basic.format()} × ${LEAVE_DAYS_PER_YEAR} ÷ ${LEAVE_DAY_DIVISOR}) ÷ 12`,
        }),
      );
    }

    const provisions = bonus.add(leaveEncashment);

    steps.push(
      new Step({
        label: 'Gross salary',
        amount: gross,
        formula:
          `${monthlyCtc.format()} − ${pfEmployer.format()} − ${esi.employerContribution.format()} − ` +
          `${gratuityProvision.format()}${provisions.isZero() ? '' : ` − ${provisions.format()}`}`,
      }),
      new Step({
        label: 'Special allowance (balancing figure)',
        amount: specialAllowance,
        formula: `${gross.format()} − ${basic.format()} − ${hra.format()}`,
      }),
      new Step({
        label: 'Employee provident fund',
        amount: employeePf,
        formula: `12% of PF wages of ${basic.format()}`,
        citation: epf.citation(),
      }),
      new Step({ label: 'Professional tax', amount: professionalTax, formula: 'annual state levy ÷ 12' }),
      new Step({ label: 'TDS', amount: tds, formula: 'annual liability under section 192 ÷ 12' }),
      new Step({ label: 'Total deductions', amount: totalDeductions }),
      new Step({
        label: 'Net in hand',
        amount: netInHand,
        formula: `${gross.format()} − ${totalDeductions.format()}`,
      }),
    );

    return steps;
  }

  /**
   * The conventions this breakdown rests on that are not in any statute. A salary
   * structure is full of them, and an employee comparing two offers needs to know
   * which numbers are law and which are house style.
   */
  private assumptions(
    annualCtc: Money,
    monthlyCtc: Money,
    includeBonus: boolean,
    includeLeaveEncashment: boolean,
    employerPfRestrictedToCeiling: boolean,
    regime: string,
  ): string[] {
    const assumptions = [
      'Special allowance is the balancing figure, so the components add back to the CTC exactly.',
      employerPfRestrictedToCeiling
        ? 'Employer PF is restricted to the ₹15,000 statutory wage ceiling, as para 26A permits.'
        : 'Employer PF is contributed on full basic wages rather than the ₹15,000 ceiling.',
      'EDLI and PF administration charges are excluded from the CTC: the administration minimum is a ' +
        'per-establishment charge, not a per-employee one.',
      'Gratuity is shown as the monthly accrual. It is payable only after five years of continuous service.',
      `TDS is estimated under the ${regime} regime on this salary alone, with the employee's own provident ` +
        'fund claimed under section 80C and no other investment declaration.',
      'Professional tax is shown as the annual state levy divided by twelve, so a state that charges a ' +
        'higher amount in one month is averaged rather than shown month by month.',
    ];

    if (regime === 'old') {
      assumptions.push(
        'No house rent allowance exemption under section 10(13A) is claimed, because rent paid is not an ' +
          'input to a CTC structure. An employee paying rent will take home more than this.',
      );
    }

    // A CTC that does not divide evenly by twelve cannot be reproduced from its
    // own monthly column, and the difference belongs on the page rather than in a
    // footnote nobody wrote.
    const residue = annualCtc.subtract(monthlyCtc.multiply(12));

    if (!residue.isZero()) {
      assumptions.push(
        'The annual column is the monthly figure times twelve, which differs from the stated CTC of ' +
          `${annualCtc.format()} by ${residue.format()}, because it does not divide evenly by twelve.`,
      );
    }

    if (includeBonus) {
      assumptions.push(
        'Statutory bonus is provided for at the minimum 8.33% on basic wages, subject to the ₹21,000 ' +
          'eligibility limit and the ₹7,000 calculation ceiling.',
      );
    }

    if (includeLeaveEncashment) {
      assumptions.push(
        `Leave encashment is provided for at ${LEAVE_DAYS_PER_YEAR} days of earned leave a year, valued at a ` +
          `${LEAVE_DAY_DIVISOR}th of basic a day. Both are conventions, not statutory quantities.`,
      );
    }

    return assumptions;
  }
}

/** A cost-to-company broken into the components an offer letter lists. */
export function calculateCtc(input: CtcInput, rates?: RateRepository): CtcResult {
  return new CtcCalculator(rates).calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/ctc` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const ctc = calculateCtc;
