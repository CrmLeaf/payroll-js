import { type DateInput, financialYearOf } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, rateLabel } from '../money.js';
import { RateRepository, type RateTable, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

export const REGIMES = ['new', 'old'] as const;
export type Regime = (typeof REGIMES)[number];

export type DeductionClaims = Record<string, Money | number | string>;

export interface IncomeTaxInput {
  grossSalary: Money | number | string;
  regime?: string;
  age?: number;
  /**
   * Keyed by the rate table's section names - '80c', '80ccd_1b', '80d_self_below_60',
   * '80tta', '80ttb', '24b_self_occupied', '80ccd_2'. Amounts are in rupees unless
   * given as Money.
   */
  deductions?: DeductionClaims;
  otherIncome?: Money | number | string | null;
  asOf?: DateInput;
}

interface Slab {
  from: number;
  to: number | null;
  rate: number;
}

export interface SlabRow {
  from: number;
  from_formatted: string;
  to: number | null;
  to_formatted: string;
  rate: number;
  taxable: number;
  taxable_formatted: string;
  tax: number;
  tax_formatted: string;
}

export interface AppliedDeduction {
  section: string;
  claimed: number;
  claimed_formatted: string;
  allowed: number;
  allowed_formatted: string;
  limit: number | null;
  limit_formatted: string | null;
}

export interface IgnoredDeduction {
  section: string;
  claimed: number;
  claimed_formatted: string;
  reason: string;
}

/** Annual income tax on salary income under either regime. */
export class IncomeTaxResult extends Result {
  constructor(
    readonly grossSalary: Money,
    readonly otherIncome: Money,
    readonly regime: string,
    readonly age: number,
    readonly ageBand: string,
    readonly financialYear: string,
    readonly standardDeduction: Money,
    readonly chapterViaDeductions: Money,
    readonly totalDeductions: Money,
    readonly taxableIncome: Money,
    readonly slabTax: Money,
    readonly rebate: Money,
    readonly marginalRelief: Money,
    readonly taxAfterRebate: Money,
    readonly surcharge: Money,
    readonly surchargeRate: number,
    readonly surchargeMarginalRelief: Money,
    readonly cess: Money,
    readonly cessRate: number,
    readonly totalTax: Money,
    readonly effectiveRate: number,
    readonly slabBreakdown: SlabRow[],
    readonly appliedDeductions: AppliedDeduction[],
    readonly ignoredDeductions: IgnoredDeduction[],
    readonly notes: string[],
  ) {
    super();
  }

  get amount(): Money {
    return this.totalTax;
  }

  static withSteps(result: IncomeTaxResult, steps: Step[]): IncomeTaxResult {
    return result.withWorking(steps);
  }

  explain(): string {
    let parts =
      `(${this.grossSalary.format()} salary + ${this.otherIncome.format()} other income − ` +
      `${this.totalDeductions.format()} deductions) = ${this.taxableIncome.format()} taxable → slab tax ` +
      `${this.slabTax.format()}`;

    if (this.rebate.isPositive()) {
      parts += ` − 87A rebate ${this.rebate.format()}`;
    }

    if (this.marginalRelief.isPositive()) {
      parts += ` − marginal relief ${this.marginalRelief.format()}`;
    }

    if (this.surcharge.isPositive()) {
      parts += ` + surcharge @ ${rateLabel(this.surchargeRate)}% ${this.surcharge.format()}`;
    }

    return `${parts} + cess @ ${rateLabel(this.cessRate)}% ${this.cess.format()} = ${this.totalTax.format()}`;
  }

  toArray(): Record<string, unknown> {
    return {
      regime: this.regime,
      age: this.age,
      age_band: this.ageBand,
      financial_year: this.financialYear,
      gross_salary: this.grossSalary.toRupees(),
      gross_salary_formatted: this.grossSalary.format(),
      other_income: this.otherIncome.toRupees(),
      other_income_formatted: this.otherIncome.format(),
      standard_deduction: this.standardDeduction.toRupees(),
      standard_deduction_formatted: this.standardDeduction.format(),
      chapter_via_deductions: this.chapterViaDeductions.toRupees(),
      chapter_via_deductions_formatted: this.chapterViaDeductions.format(),
      total_deductions: this.totalDeductions.toRupees(),
      total_deductions_formatted: this.totalDeductions.format(),
      taxable_income: this.taxableIncome.toRupees(),
      taxable_income_formatted: this.taxableIncome.format(),
      slab_tax: this.slabTax.toRupees(),
      slab_tax_formatted: this.slabTax.format(),
      rebate: this.rebate.toRupees(),
      rebate_formatted: this.rebate.format(),
      marginal_relief: this.marginalRelief.toRupees(),
      marginal_relief_formatted: this.marginalRelief.format(),
      tax_after_rebate: this.taxAfterRebate.toRupees(),
      tax_after_rebate_formatted: this.taxAfterRebate.format(),
      surcharge: this.surcharge.toRupees(),
      surcharge_formatted: this.surcharge.format(),
      surcharge_rate: this.surchargeRate,
      surcharge_marginal_relief: this.surchargeMarginalRelief.toRupees(),
      surcharge_marginal_relief_formatted: this.surchargeMarginalRelief.format(),
      cess: this.cess.toRupees(),
      cess_formatted: this.cess.format(),
      cess_rate: this.cessRate,
      total_tax: this.totalTax.toRupees(),
      total_tax_formatted: this.totalTax.format(),
      effective_rate: this.effectiveRate,
      slab_breakdown: this.slabBreakdown,
      applied_deductions: this.appliedDeductions,
      ignored_deductions: this.ignoredDeductions,
      notes: this.notes,
    };
  }
}

/**
 * Annual income tax on salary income under either regime.
 *
 * The order of operations is not negotiable and is where most home-grown
 * calculators go wrong: deductions, then slabs, then the section 87A rebate,
 * then marginal relief on that rebate, then surcharge with its own separate
 * marginal relief, then cess on the lot, then section 288B rounding. Applying
 * cess before marginal relief, or surcharge on the tax before the rebate,
 * quietly changes the answer by thousands of rupees.
 */
export class IncomeTaxCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: IncomeTaxInput): IncomeTaxResult {
    const grossSalary = Money.from(input.grossSalary);
    const age = input.age ?? 30;
    const deductions = input.deductions ?? {};

    if (grossSalary.isNegative()) {
      throw InvalidInputError.negative('Gross salary');
    }

    const otherIncome =
      input.otherIncome === null || input.otherIncome === undefined ? Money.zero() : Money.from(input.otherIncome);

    if (otherIncome.isNegative()) {
      throw InvalidInputError.negative('Other income');
    }

    if (age < 0 || age > 120) {
      throw InvalidInputError.outOfRange('Age', 'between 0 and 120', age);
    }

    const regime = String(input.regime ?? 'new').trim().toLowerCase();

    if (!(REGIMES as readonly string[]).includes(regime)) {
      throw InvalidInputError.unknownOption('regime', regime, REGIMES);
    }

    const table = this.rates.for('income-tax', input.asOf);
    const citation = table.citation();
    const prefix = `${regime}_regime`;

    const steps: Step[] = [];

    // 1. Standard deduction under section 16(ia). It is a deduction from salary,
    //    so it can never exceed the salary - a ₹40,000 salary gets ₹40,000 of it,
    //    not ₹75,000 that would turn into a loss.
    const fullStandardDeduction = table.money(`${prefix}.standard_deduction`);
    const standardDeduction = fullStandardDeduction.min(grossSalary);

    steps.push(
      new Step({
        label: 'Standard deduction',
        amount: standardDeduction,
        formula: `min(${grossSalary.format()} salary, ${fullStandardDeduction.format()})`,
        citation,
        context: { section: '16(ia)', regime },
      }),
    );

    // 2. Chapter VI-A and section 24(b). The new regime allows almost none of
    //    this; claims it refuses are reported rather than dropped.
    const resolved = this.resolveDeductions(table, regime, age, grossSalary, deductions);
    const notes = resolved.notes;

    // A rate table that names a financial year and is being applied to a later
    // one is an assumption, not a fact: the Finance Act for the newer year may
    // change any of it. Saying so here rather than only exposing
    // isProvisionalFor() is the difference between a caller who can see the
    // assumption and one who is silently given last year's slabs.
    const provisional = table.provisionalWarning(RateRepository.asDate(input.asOf ?? null));

    if (provisional !== null) {
      notes.push(provisional);
    }

    for (const entry of resolved.applied) {
      steps.push(
        new Step({
          label: `Deduction under section ${entry.section.toUpperCase()}`,
          amount: Money.fromRupees(entry.allowed),
          formula:
            entry.limit === null
              ? `${Money.fromRupees(entry.claimed).format()} claimed, no statutory ceiling`
              : `min(${Money.fromRupees(entry.claimed).format()} claimed, ${Money.fromRupees(
                  entry.limit,
                ).format()} ceiling)`,
          citation,
          context: { section: entry.section },
        }),
      );
    }

    // 3. Total income.
    const totalDeductions = standardDeduction.add(resolved.total);
    const taxableIncome = grossSalary.add(otherIncome).subtract(totalDeductions).floorAtZero();

    steps.push(
      new Step({
        label: 'Total taxable income',
        amount: taxableIncome,
        formula: `${grossSalary.format()} + ${otherIncome.format()} − ${totalDeductions.format()}`,
        citation,
      }),
    );

    // 4. Slab tax.
    const slabs = this.slabsFor(table, regime, age);
    const { tax: slabTax, breakdown } = slabTaxFor(slabs, taxableIncome);

    steps.push(
      new Step({
        label: 'Tax at slab rates',
        amount: slabTax,
        formula: describeSlabs(breakdown),
        citation,
        context: { regime, age_band: ageBandFor(age) },
      }),
    );

    // 5 & 6. Rebate under section 87A, and the marginal relief that keeps the
    //        cliff at the rebate threshold from costing more tax than the extra
    //        rupee of income that caused it.
    const rebateLimit = table.money(`${prefix}.rebate_87a.income_limit`);
    const maxRebate = table.money(`${prefix}.rebate_87a.max_rebate`);
    const marginalReliefAllowed = table.bool(`${prefix}.rebate_87a.marginal_relief`);

    let rebate = Money.zero();
    let marginalRelief = Money.zero();

    if (taxableIncome.lessThanOrEqual(rebateLimit)) {
      rebate = slabTax.min(maxRebate);

      steps.push(
        new Step({
          label: 'Rebate under section 87A',
          amount: rebate,
          formula:
            `min(${slabTax.format()} tax, ${maxRebate.format()}) because total income ` +
            `${taxableIncome.format()} ≤ ${rebateLimit.format()}`,
          citation,
          context: { section: '87A' },
        }),
      );
    } else if (marginalReliefAllowed) {
      // The proviso to section 87A: tax payable is capped at the amount by which
      // total income exceeds the rebate threshold. At ₹12,10,000 the slabs give
      // ₹61,500 but only ₹10,000 is payable, because ₹10,000 is all the income
      // there is above ₹12,00,000. Relief is computed on tax before cess; cess is
      // then charged on the reduced figure.
      const excess = taxableIncome.subtract(rebateLimit);
      const capped = slabTax.min(excess);
      marginalRelief = slabTax.subtract(capped);

      if (marginalRelief.isPositive()) {
        steps.push(
          new Step({
            label: 'Marginal relief on the section 87A threshold',
            amount: marginalRelief,
            formula:
              `${slabTax.format()} tax − min(${slabTax.format()}, ${excess.format()} excess over ` +
              `${rebateLimit.format()})`,
            citation,
            context: { section: '87A proviso' },
          }),
        );
      }
    }

    const taxAfterRebate = slabTax.subtract(rebate, marginalRelief).floorAtZero();

    // 7. Surcharge. The bands are tested against total income, but the surcharge
    //    itself is a percentage of the tax.
    const surchargeResult = this.surcharge(
      table,
      prefix,
      slabs,
      taxableIncome,
      taxAfterRebate,
      rebateLimit,
      maxRebate,
      marginalReliefAllowed,
      citation,
    );

    steps.push(...surchargeResult.steps);

    // 8. Health and education cess on tax plus surcharge.
    const cessRate = table.float(`${prefix}.cess_rate`);
    const cess = taxAfterRebate.add(surchargeResult.surcharge).percentage(cessRate);

    steps.push(
      new Step({
        label: 'Health and education cess',
        amount: cess,
        formula: `${rateLabel(cessRate)}% × (${taxAfterRebate.format()} + ${surchargeResult.surcharge.format()})`,
        citation,
      }),
    );

    // 9. Section 288B: the amount payable is rounded to the nearest ₹10.
    const beforeRounding = taxAfterRebate.add(surchargeResult.surcharge, cess);
    const totalTax = beforeRounding.roundToTenRupees();

    steps.push(
      new Step({
        label: 'Total tax payable, rounded',
        amount: totalTax,
        formula: `${beforeRounding.format()} rounded to the nearest ₹10`,
        citation: `${table.statute} - ${table.string('rounding.citation')}`,
      }),
    );

    const totalIncome = grossSalary.add(otherIncome);
    const effectiveRate = totalIncome.isPositive()
      ? round2((totalTax.paise / totalIncome.paise) * 100)
      : 0;

    const result = new IncomeTaxResult(
      grossSalary,
      otherIncome,
      regime,
      age,
      ageBandFor(age),
      financialYearOf(table.effectiveFrom),
      standardDeduction,
      resolved.total,
      totalDeductions,
      taxableIncome,
      slabTax,
      rebate,
      marginalRelief,
      taxAfterRebate,
      surchargeResult.surcharge,
      surchargeResult.rate,
      surchargeResult.relief,
      cess,
      cessRate,
      totalTax,
      effectiveRate,
      breakdown,
      resolved.applied,
      resolved.ignored,
      notes,
    );

    return IncomeTaxResult.withSteps(result, steps);
  }

  /** The slab ladder in force for this regime and, in the old regime, this age. */
  private slabsFor(table: RateTable, regime: string, age: number): Slab[] {
    const raw =
      regime === 'new'
        ? table.array<Record<string, unknown>>('new_regime.slabs')
        : table.array<Record<string, unknown>>(`old_regime.slabs_by_age.${ageBandFor(age)}`);

    return raw.map((slab) => ({
      from: Number(slab.from ?? 0),
      to: slab.to === null || slab.to === undefined ? null : Number(slab.to),
      rate: Number(slab.rate ?? 0),
    }));
  }

  /**
   * Surcharge plus its marginal relief.
   *
   * The bands are crossed by *income* but levied on *tax*, and each threshold
   * carries relief of its own: the extra tax and surcharge from crossing it can
   * never exceed the extra income that crossed it. Without this, ₹51,00,000 of
   * income leaves you worse off than ₹50,00,000.
   */
  private surcharge(
    table: RateTable,
    prefix: string,
    slabs: Slab[],
    income: Money,
    tax: Money,
    rebateLimit: Money,
    maxRebate: Money,
    marginalReliefAllowed: boolean,
    citation: string,
  ): { surcharge: Money; rate: number; relief: Money; steps: Step[] } {
    const bands = table
      .array<Record<string, unknown>>(`${prefix}.surcharge`)
      .map((band) => ({ above: Number(band.above), rate: Number(band.rate) }))
      .sort((a, b) => a.above - b.above);

    const rate = surchargeRateFor(bands, income);

    if (rate <= 0) {
      return { surcharge: Money.zero(), rate: 0, relief: Money.zero(), steps: [] };
    }

    let threshold = Money.zero();
    for (const band of bands) {
      if (income.paise > band.above) {
        threshold = Money.fromPaise(band.above);
      }
    }

    let surcharge = tax.percentage(rate);
    let relief = Money.zero();

    const steps: Step[] = [
      new Step({
        label: `Surcharge at ${rateLabel(rate)}%`,
        amount: surcharge,
        formula:
          `${rateLabel(rate)}% × ${tax.format()} tax, because total income ${income.format()} exceeds ` +
          `${threshold.format()}`,
        citation,
      }),
    ];

    // Tax at the threshold itself carries the *previous* band's surcharge, which
    // is why the rate is re-resolved at the threshold rather than assumed to be
    // nil - at ₹1 crore the comparison is against ₹1 crore's tax plus 10%
    // surcharge, not its bare slab tax.
    const taxAtThreshold = taxBeforeSurcharge(slabs, threshold, rebateLimit, maxRebate, marginalReliefAllowed);
    const rateAtThreshold = surchargeRateFor(bands, threshold);
    const liabilityAtThreshold = taxAtThreshold.add(taxAtThreshold.percentage(rateAtThreshold));

    const cap = liabilityAtThreshold.add(income.subtract(threshold));
    const liability = tax.add(surcharge);

    if (liability.greaterThan(cap)) {
      const relieved = cap.subtract(tax).floorAtZero();
      relief = surcharge.subtract(relieved);
      surcharge = relieved;

      steps.push(
        new Step({
          label: 'Marginal relief on surcharge',
          amount: relief,
          formula:
            `${liability.format()} − (${liabilityAtThreshold.format()} liability at ${threshold.format()} + ` +
            `${income.subtract(threshold).format()} income above it)`,
          citation,
        }),
      );
    }

    return { surcharge, rate, relief, steps };
  }

  /**
   * Cap each claim at its statutory ceiling, and separate the claims this regime
   * simply does not entertain.
   */
  private resolveDeductions(
    table: RateTable,
    regime: string,
    age: number,
    grossSalary: Money,
    deductions: DeductionClaims,
  ): { total: Money; applied: AppliedDeduction[]; ignored: IgnoredDeduction[]; notes: string[] } {
    const limits = table.record<unknown>('old_regime.deduction_limits');

    // The old regime's ceiling list doubles as the vocabulary of sections this
    // library understands. A section missing from it is a caller mistake; a
    // section present but not allowed under the new regime is a statutory
    // refusal, which is a very different thing.
    const ceilings = new Map<string, Money | null>();

    for (const [section, limit] of Object.entries(limits)) {
      if (section.endsWith('_percent_of_salary') || typeof limit === 'boolean') {
        continue;
      }
      ceilings.set(section, typeof limit === 'number' ? Money.fromPaise(limit) : null);
    }

    ceilings.set('80ccd_2', null);

    const applied: AppliedDeduction[] = [];
    const ignored: IgnoredDeduction[] = [];
    const notes: string[] = [];
    let total = Money.zero();

    for (const [section, claimed] of Object.entries(deductions)) {
      const key = normaliseSection(section, age);

      if (!ceilings.has(key)) {
        throw InvalidInputError.unknownOption('deduction section', section, [...ceilings.keys()]);
      }

      const amount = toClaim(claimed, `Deduction under ${key}`);

      if (regime === 'new' && key !== '80ccd_2') {
        ignored.push({
          section: key,
          claimed: amount.toRupees(),
          claimed_formatted: amount.format(),
          reason: 'The new regime under section 115BAC(1A) does not allow this deduction.',
        });
        continue;
      }

      let limit = ceilings.get(key) ?? null;

      if (key === '80ccd_2') {
        // The employer's NPS contribution is capped as a percentage of salary
        // rather than at a flat figure.
        limit = employerNpsCeiling(table, regime, grossSalary, notes);
      }

      const allowed = limit === null ? amount : amount.min(limit);
      total = total.add(allowed);

      applied.push({
        section: key,
        claimed: amount.toRupees(),
        claimed_formatted: amount.format(),
        allowed: allowed.toRupees(),
        allowed_formatted: allowed.format(),
        limit: limit === null ? null : limit.toRupees(),
        limit_formatted: limit === null ? null : limit.format(),
      });
    }

    if (ignored.length > 0) {
      notes.push(
        `The new regime disallows ${ignored
          .map((entry) => entry.section.toUpperCase())
          .join(', ')}. Those claims have been shown but not deducted; compare the regimes before opting out ` +
          'of section 115BAC.',
      );
    }

    return { total, applied, ignored, notes };
  }
}

function employerNpsCeiling(
  table: RateTable,
  regime: string,
  grossSalary: Money,
  notes: string[],
): Money | null {
  const percent = table.get(`${regime}_regime.deduction_limits.80ccd_2_percent_of_salary`, null);

  if (typeof percent !== 'number') {
    // The new regime permits a higher 80CCD(2) ceiling than the old one, but this
    // version of the table does not carry the figure. Inventing it here would
    // hide a rate-table gap inside the engine, so the claim is allowed in full
    // and the gap is reported.
    notes.push(
      `The rate table carries no section 80CCD(2) ceiling for the ${regime} regime, so the employer NPS ` +
        'contribution has been allowed in full. Verify it against the percentage of salary the section permits.',
    );
    return null;
  }

  return grossSalary.percentage(percent);
}

/**
 * The old regime raises the exemption limit at 60 and again at 80. The new
 * regime has one ladder for everybody, but the band is still reported so the
 * output explains itself either way.
 */
export function ageBandFor(age: number): string {
  if (age >= 80) return 'super_senior_80_plus';
  return age >= 60 ? 'senior_60_to_80' : 'below_60';
}

function slabTaxFor(slabs: Slab[], income: Money): { tax: Money; breakdown: SlabRow[] } {
  let tax = Money.zero();
  const breakdown: SlabRow[] = [];

  for (const slab of slabs) {
    const upper = slab.to ?? income.paise;
    const inSlab = Math.max(0, Math.min(income.paise, upper) - slab.from);

    const slabIncome = Money.fromPaise(inSlab);
    const slabTax = slabIncome.percentage(slab.rate);
    tax = tax.add(slabTax);

    const from = Money.fromPaise(slab.from);
    const to = slab.to === null ? null : Money.fromPaise(slab.to);

    breakdown.push({
      from: from.toRupees(),
      from_formatted: from.format(),
      to: to === null ? null : to.toRupees(),
      to_formatted: to === null ? 'and above' : to.format(),
      rate: slab.rate,
      taxable: slabIncome.toRupees(),
      taxable_formatted: slabIncome.format(),
      tax: slabTax.toRupees(),
      tax_formatted: slabTax.format(),
    });
  }

  return { tax, breakdown };
}

function describeSlabs(breakdown: SlabRow[]): string {
  const parts = breakdown
    .filter((slab) => slab.taxable > 0 && slab.rate > 0)
    .map((slab) => `${rateLabel(slab.rate)}% × ${slab.taxable_formatted}`);

  return parts.length === 0 ? 'nil - income is within the exempt slab' : parts.join(' + ');
}

function surchargeRateFor(bands: Array<{ above: number; rate: number }>, income: Money): number {
  let rate = 0;

  for (const band of bands) {
    // "Exceeds" is strict: income of exactly ₹50,00,000 attracts none.
    if (income.paise > band.above) {
      rate = band.rate;
    }
  }

  return rate;
}

/**
 * Slab tax after rebate and 87A marginal relief but before surcharge - the
 * figure the surcharge threshold comparison needs.
 */
function taxBeforeSurcharge(
  slabs: Slab[],
  income: Money,
  rebateLimit: Money,
  maxRebate: Money,
  marginalReliefAllowed: boolean,
): Money {
  const { tax } = slabTaxFor(slabs, income);

  if (income.lessThanOrEqual(rebateLimit)) {
    return tax.subtract(tax.min(maxRebate)).floorAtZero();
  }

  if (marginalReliefAllowed) {
    return tax.min(income.subtract(rebateLimit)).floorAtZero();
  }

  return tax;
}

/**
 * Accept both the shorthand '80d' and the explicit ceiling keys, resolving the
 * shorthand by age since the self-cover limit doubles at 60.
 */
function normaliseSection(section: string, age: number): string {
  let key = section.trim().toLowerCase();
  key = key.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  switch (key) {
    case 'section_80c':
    case '80_c':
      return '80c';
    case '80d':
      return age >= 60 ? '80d_self_60_plus' : '80d_self_below_60';
    case '80d_parents':
      return age >= 60 ? '80d_parents_60_plus' : '80d_parents_below_60';
    case '80ccd_1_b':
    case '80ccd1b':
      return '80ccd_1b';
    case '80ccd2':
    case '80ccd_2_':
      return '80ccd_2';
    case '24b':
    case 'section_24b':
      return '24b_self_occupied';
    default:
      return key;
  }
}

function toClaim(value: Money | number | string, field: string): Money {
  if (typeof value === 'string' && !Number.isFinite(Number(value.trim()))) {
    throw InvalidInputError.outOfRange(field, 'a rupee amount', value);
  }

  const amount = Money.from(value);

  if (amount.isNegative()) {
    throw InvalidInputError.negative(field);
  }

  return amount;
}

/** PHP's `round($value, 2)`, which rounds halves away from zero. */
export function round2(value: number): number {
  const scaled = value * 100;
  const corrected = Number(scaled.toPrecision(15));
  return (corrected >= 0 ? Math.floor(corrected + 0.5) : Math.ceil(corrected - 0.5)) / 100;
}

/** Annual income tax on salary income under either regime. */
export function calculateIncomeTax(input: IncomeTaxInput, rates?: RateRepository): IncomeTaxResult {
  return new IncomeTaxCalculator(rates).calculate(input);
}
