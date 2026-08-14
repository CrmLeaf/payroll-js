import type { DateInput } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money } from '../money.js';
import { RateRepository, type RateTable, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

/**
 * States whose levy is conditional on the employee being liable to income tax
 * rather than on a salary slab. Punjab's development tax is the only one; the
 * rate table carries the rule in prose rather than as a flag, so it lives here
 * until a future table version exposes `liability_based`.
 */
const LIABILITY_BASED_STATES = ['Punjab'];

const PERIODS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  half_yearly: 2,
  annual: 1,
};

export interface ProfessionalTaxInput {
  monthlySalary: Money | number | string;
  state: string;
  /** Calendar month number, 1 = January - special-month states are written against calendar months. */
  month?: number;
  gender?: string;
  liableToIncomeTax?: boolean;
  asOf?: DateInput;
}

/** Professional tax under the various state enactments made under Article 276. */
export class ProfessionalTaxResult extends Result {
  constructor(
    readonly state: string,
    readonly monthlySalary: Money,
    readonly month: number,
    readonly levied: boolean,
    readonly applicable: boolean,
    readonly frequency: string,
    readonly periodsPerYear: number,
    readonly assessableIncome: Money,
    readonly amountDue: Money,
    readonly scheduledAmount: Money,
    readonly monthlyEquivalent: Money,
    readonly annualTotal: Money,
    readonly slabFrom: Money | null,
    readonly slabTo: Money | null,
    readonly specialMonthApplied: boolean,
    readonly genderExempt: boolean,
    readonly cappedAtStatutoryLimit: boolean,
    readonly reason: string,
    readonly source: string,
  ) {
    super();
  }

  get amount(): Money {
    return this.amountDue;
  }

  static withSteps(result: ProfessionalTaxResult, steps: Step[]): ProfessionalTaxResult {
    return result.withWorking(steps);
  }

  explain(): string {
    if (!this.levied) {
      return `${this.state} has not enacted a professional tax, so nothing is deducted.`;
    }

    if (!this.applicable) {
      return `No professional tax in ${this.state}: ${this.reason}.`;
    }

    return (
      `${this.state} levies ${this.scheduledAmount.format()} ${this.frequency.replace(/_/g, '-')} on an ` +
      `assessable income of ${this.assessableIncome.format()}; ${this.annualTotal.format()} a year, ` +
      `${this.monthlyEquivalent.format()} a month`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      state: this.state,
      monthly_salary: this.monthlySalary.toRupees(),
      monthly_salary_formatted: this.monthlySalary.format(),
      month: this.month,
      levied: this.levied,
      applicable: this.applicable,
      frequency: this.frequency,
      periods_per_year: this.periodsPerYear,
      assessable_income: this.assessableIncome.toRupees(),
      assessable_income_formatted: this.assessableIncome.format(),
      amount: this.amountDue.toRupees(),
      amount_formatted: this.amountDue.format(),
      scheduled_amount: this.scheduledAmount.toRupees(),
      scheduled_amount_formatted: this.scheduledAmount.format(),
      monthly_equivalent: this.monthlyEquivalent.toRupees(),
      monthly_equivalent_formatted: this.monthlyEquivalent.format(),
      annual_total: this.annualTotal.toRupees(),
      annual_total_formatted: this.annualTotal.format(),
      slab_from: this.slabFrom?.toRupees() ?? null,
      slab_to: this.slabTo?.toRupees() ?? null,
      special_month_applied: this.specialMonthApplied,
      gender_exempt: this.genderExempt,
      capped_at_statutory_limit: this.cappedAtStatutoryLimit,
      reason: this.reason,
      source: this.source,
    };
  }
}

interface StateSlab {
  from: number;
  to: number | null;
  amount: number;
}

interface StateConfig {
  frequency?: string;
  source?: string;
  slabs: StateSlab[];
  special_month?: { month: number; amount: number };
  gender_exemption?: { gender: string; up_to: number };
  liability_based?: boolean;
}

/**
 * Professional tax under the various state enactments made under Article 276.
 *
 * There is no national schedule, so almost everything here is a lookup rather
 * than a formula. The parts that are easy to get wrong: a state's slab bounds are
 * expressed in that state's own assessment period (Tamil Nadu's are half-yearly,
 * Bihar's are annual), several states levy a higher amount in one month so the
 * year lands exactly on ₹2,500, and Article 276(2) caps the whole thing at ₹2,500
 * per person per year whatever the state schedule says.
 */
export class ProfessionalTaxCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: ProfessionalTaxInput): ProfessionalTaxResult {
    const monthlySalary = Money.from(input.monthlySalary);
    const month = input.month ?? 4;
    const liableToIncomeTax = input.liableToIncomeTax ?? true;

    if (monthlySalary.isNegative()) {
      throw InvalidInputError.negative('Monthly salary');
    }

    if (month < 1 || month > 12) {
      throw InvalidInputError.outOfRange('Month', 'between 1 and 12', month);
    }

    const gender = String(input.gender ?? 'male').trim().toLowerCase();

    if (!['male', 'female', 'other'].includes(gender)) {
      throw InvalidInputError.unknownOption('gender', gender, ['male', 'female', 'other']);
    }

    const table = this.rates.for('professional-tax', input.asOf);
    const states = table.record<StateConfig>('states');
    const cap = table.money('annual_cap');

    const canonical = canonicalise(input.state, Object.keys(states));

    if (canonical === null) {
      const without = table.array<string>('states_without_professional_tax').map(String);
      const canonicalWithout = canonicalise(input.state, without);

      if (canonicalWithout !== null) {
        return this.noLevy(canonicalWithout, monthlySalary, month, table);
      }

      throw InvalidInputError.unsupportedState(input.state);
    }

    const config = states[canonical];
    const source = String(config.source ?? '');
    const citation = `${table.statute} - ${source}`;

    const frequency = String(config.frequency ?? 'monthly');

    if (!(frequency in PERIODS_PER_YEAR)) {
      throw InvalidInputError.unknownOption('frequency', frequency, Object.keys(PERIODS_PER_YEAR));
    }

    const periodsPerYear = PERIODS_PER_YEAR[frequency];
    const monthsPerPeriod = Math.trunc(12 / periodsPerYear);

    // Slab bounds are stated in the assessment period's own income, so a Tamil
    // Nadu employee on ₹30,000 a month is tested against ₹1,80,000.
    const assessable = monthlySalary.multiply(monthsPerPeriod);

    const steps: Step[] = [
      new Step({
        label: `Assessable income (${frequency.replace(/_/g, '-')})`,
        amount: assessable,
        formula: monthsPerPeriod === 1 ? monthlySalary.format() : `${monthlySalary.format()} × ${monthsPerPeriod}`,
        citation,
        context: { frequency, state: canonical },
      }),
    ];

    if (genderExemptFor(config, gender, assessable)) {
      const limit = Money.fromPaise(config.gender_exemption!.up_to);

      steps.push(
        new Step({
          label: 'Gender exemption',
          amount: Money.zero(),
          formula: `${gender} employee earning up to ${limit.format()} pays nil`,
          citation,
        }),
      );

      return this.exempt(
        canonical,
        monthlySalary,
        month,
        frequency,
        periodsPerYear,
        assessable,
        true,
        `${gender.charAt(0).toUpperCase()}${gender.slice(1)} employees earning up to ${limit.format()} a month are exempt`,
        source,
        steps,
      );
    }

    const liabilityBased = Boolean(config.liability_based ?? LIABILITY_BASED_STATES.includes(canonical));

    if (liabilityBased && !liableToIncomeTax) {
      steps.push(
        new Step({
          label: 'Income tax liability test',
          amount: Money.zero(),
          formula: 'employee not liable to income tax → levy does not apply',
          citation,
        }),
      );

      return this.exempt(
        canonical,
        monthlySalary,
        month,
        frequency,
        periodsPerYear,
        assessable,
        false,
        'the levy applies only to persons liable to income tax',
        source,
        steps,
      );
    }

    const slabs = config.slabs;
    const [slabIndex, slab] = matchSlab(slabs, assessable);

    const slabFrom = Money.fromPaise(slab.from);
    const slabTo = slab.to === null ? null : Money.fromPaise(slab.to);
    const scheduled = Money.fromPaise(slab.amount);

    steps.push(
      new Step({
        label: 'Slab levy',
        amount: scheduled,
        formula: slabTo === null ? `income above ${slabFrom.format()}` : `income up to ${slabTo.format()}`,
        citation,
        context: { slab: slabIndex + 1, of: slabs.length },
      }),
    );

    // A special month is an uplift on the *top* slab only. Maharashtra's ₹300
    // February applies to the ₹200 band, not to the ₹175 band - eleven months at
    // ₹175 plus ₹300 would be an amount the schedule never names.
    const isTopSlab = slabIndex === slabs.length - 1;

    const special = config.special_month ?? null;
    const specialMonth = special !== null ? Number(special.month) : null;
    const specialAmount = special !== null ? Money.fromPaise(special.amount) : null;
    const specialInPlay = special !== null && isTopSlab && frequency === 'monthly' && scheduled.isPositive();

    const amountDue =
      specialInPlay && specialMonth === month && specialAmount !== null ? specialAmount : scheduled;

    let uncapped: Money;

    if (specialInPlay && specialAmount !== null) {
      uncapped = scheduled.multiply(periodsPerYear - 1).add(specialAmount);

      steps.push(
        new Step({
          label: `Special month (${specialMonth})`,
          amount: specialAmount,
          formula: `${specialAmount.format()} in month ${specialMonth} so the year totals ${uncapped.format()}`,
          citation,
        }),
      );
    } else {
      uncapped = scheduled.multiply(periodsPerYear);
    }

    const annual = uncapped.min(cap);
    const capped = annual.lessThan(uncapped);

    steps.push(
      new Step({
        label: 'Annual total',
        amount: annual,
        formula: specialInPlay
          ? `(${scheduled.format()} × 11) + ${amountDue.format()}`
          : `${scheduled.format()} × ${periodsPerYear}`,
        citation,
      }),
    );

    if (capped) {
      steps.push(
        new Step({
          label: 'Article 276(2) cap',
          amount: annual,
          formula: `${uncapped.format()} capped at ${cap.format()}`,
          citation: `${table.statute} - Article 276(2) of the Constitution`,
        }),
      );
    }

    // The payslip line has to be a monthly number even where the state assesses
    // half-yearly, and it has to reconcile to the capped annual.
    const monthlyEquivalent = annual.divide(12);

    const result = new ProfessionalTaxResult(
      canonical,
      monthlySalary,
      month,
      true,
      annual.isPositive(),
      frequency,
      periodsPerYear,
      assessable,
      amountDue,
      scheduled,
      monthlyEquivalent,
      annual,
      slabFrom,
      slabTo,
      specialInPlay && specialMonth === month,
      false,
      capped,
      annual.isPositive() ? 'salary falls in a chargeable slab' : 'salary falls below the state threshold',
      source,
    );

    return ProfessionalTaxResult.withSteps(result, steps);
  }

  /** Every state in the schedule that levies professional tax, alphabetically. */
  statesWithProfessionalTax(asOf: DateInput = null): string[] {
    return Object.keys(this.rates.for('professional-tax', asOf).record('states')).sort();
  }

  /** States and union territories that levy none, alphabetically. */
  statesWithoutProfessionalTax(asOf: DateInput = null): string[] {
    return this.rates
      .for('professional-tax', asOf)
      .array<string>('states_without_professional_tax')
      .map(String)
      .sort();
  }

  private noLevy(state: string, monthlySalary: Money, month: number, table: RateTable): ProfessionalTaxResult {
    // Not levying professional tax is not a caller error and not an
    // ineligibility either - it is simply the answer for Delhi.
    const result = new ProfessionalTaxResult(
      state,
      monthlySalary,
      month,
      false,
      false,
      'none',
      0,
      monthlySalary,
      Money.zero(),
      Money.zero(),
      Money.zero(),
      Money.zero(),
      null,
      null,
      false,
      false,
      false,
      `${state} has not enacted a professional tax`,
      table.source,
    );

    return ProfessionalTaxResult.withSteps(result, [
      new Step({
        label: `${state} professional tax`,
        amount: Money.zero(),
        formula: 'no state enactment under Article 276',
        citation: table.citation(),
      }),
    ]);
  }

  private exempt(
    state: string,
    monthlySalary: Money,
    month: number,
    frequency: string,
    periodsPerYear: number,
    assessable: Money,
    genderExempt: boolean,
    reason: string,
    source: string,
    steps: Step[],
  ): ProfessionalTaxResult {
    const result = new ProfessionalTaxResult(
      state,
      monthlySalary,
      month,
      true,
      false,
      frequency,
      periodsPerYear,
      assessable,
      Money.zero(),
      Money.zero(),
      Money.zero(),
      Money.zero(),
      null,
      null,
      false,
      genderExempt,
      false,
      reason,
      source,
    );

    return ProfessionalTaxResult.withSteps(result, steps);
  }
}

/**
 * Slabs are contiguous and ascending, and their upper bound is inclusive - "up
 * to ₹10,000: nil" means ₹10,000 exactly pays nil. Taking the first band whose
 * ceiling the income does not exceed gives that reading.
 */
function matchSlab(slabs: StateSlab[], income: Money): [number, StateSlab] {
  for (let index = 0; index < slabs.length; index += 1) {
    const slab = slabs[index];

    if (income.lessThan(Money.fromPaise(slab.from))) continue;

    if (slab.to === null || income.lessThanOrEqual(Money.fromPaise(slab.to))) {
      return [index, slab];
    }
  }

  const last = slabs.length - 1;
  return [last, slabs[last]];
}

function genderExemptFor(config: StateConfig, gender: string, assessable: Money): boolean {
  const exemption = config.gender_exemption;
  if (!exemption) return false;
  if (String(exemption.gender).toLowerCase() !== gender) return false;
  return assessable.lessThanOrEqual(Money.fromPaise(exemption.up_to));
}

/**
 * Match a caller's state name against the schedule, tolerating case and stray
 * whitespace but nothing more adventurous - silently guessing at a misspelling
 * would hide a data-entry bug in someone's HRIS.
 */
function canonicalise(state: string, known: readonly string[]): string | null {
  const needle = state.trim().toLowerCase();

  for (const name of known) {
    if (name.toLowerCase() === needle) return name;
  }

  return null;
}

/** Professional tax for one employee in one state. */
export function calculateProfessionalTax(
  input: ProfessionalTaxInput,
  rates?: RateRepository,
): ProfessionalTaxResult {
  return new ProfessionalTaxCalculator(rates).calculate(input);
}

export function statesWithProfessionalTax(asOf: DateInput = null, rates?: RateRepository): string[] {
  return new ProfessionalTaxCalculator(rates).statesWithProfessionalTax(asOf);
}

export function statesWithoutProfessionalTax(asOf: DateInput = null, rates?: RateRepository): string[] {
  return new ProfessionalTaxCalculator(rates).statesWithoutProfessionalTax(asOf);
}
