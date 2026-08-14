import {
  type DateInput,
  daysBetween,
  firstDayOfNextMonth,
  formatDate,
  toDate,
  utcDate,
  year as yearOf,
  month as monthOf,
} from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, rateLabel } from '../money.js';
import { RateRepository, type RateTable, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

export interface EpfoPenaltyInput {
  /** The arrears - EPF, EPS and EDLI together, as remitted. */
  contributionAmount: Money | number | string;
  /** Any date inside the month the wages relate to. */
  wageMonth: Date | string;
  /** The date the challan was actually paid. */
  actualPaymentDate: Date | string;
  /** Overrides the rate version; leave unset so the due date governs. */
  asOf?: DateInput;
}

/**
 * Interest under section 7Q and damages under section 14B on a provident fund
 * contribution deposited after its due date.
 */
export class EpfoPenaltyResult extends Result {
  constructor(
    readonly contributionAmount: Money,
    readonly wageMonth: Date,
    readonly dueDate: Date,
    readonly actualPaymentDate: Date,
    readonly isLate: boolean,
    readonly delayDays: number,
    readonly delayMonths: number,
    readonly interest: Money,
    readonly damages: Money,
    readonly total: Money,
    readonly interestRatePerAnnum: number,
    readonly damagesBasis: string,
    readonly damagesRate: number,
    readonly damagesRateUnit: string,
    readonly damagesBand: string | null,
    readonly damagesCappedAtArrears: boolean,
    readonly rateVersion: string,
    steps: Step[],
  ) {
    super();
    this.withWorking(steps);
  }

  get amount(): Money {
    return this.total;
  }

  explain(): string {
    if (!this.isLate) {
      return (
        `Paid on ${formatDate(this.actualPaymentDate, 'd-m-Y')}, on or before the due date of ` +
        `${formatDate(this.dueDate, 'd-m-Y')} - no interest under 7Q and no damages under 14B.`
      );
    }

    const arrears = rateLabel(this.contributionAmount.toRupees());

    const interest =
      `(${arrears} × ${rateLabel(this.interestRatePerAnnum)}% × ${this.delayDays}) ÷ 365 = ` +
      `${rateLabel(this.interest.toRupees())}`;

    const damages =
      this.damagesBasis === 'flat_per_month'
        ? `${arrears} × ${rateLabel(this.damagesRate)}% × ${this.delayMonths} ` +
          `month${this.delayMonths === 1 ? '' : 's'} = ${rateLabel(this.damages.toRupees())}`
        : `(${arrears} × ${rateLabel(this.damagesRate)}% × ${this.delayDays}) ÷ 365 = ` +
          `${rateLabel(this.damages.toRupees())}`;

    return (
      `Due ${formatDate(this.dueDate, 'd-m-Y')}, paid ${formatDate(this.actualPaymentDate, 'd-m-Y')} - ` +
      `${this.delayDays} days late. Interest 7Q: ${interest}. Damages 14B: ${damages}` +
      `${this.damagesCappedAtArrears ? ' (capped at the arrears)' : ''}. ` +
      `Total payable ${rateLabel(this.total.toRupees())}.`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      contribution_amount: this.contributionAmount.toRupees(),
      contribution_amount_formatted: this.contributionAmount.format(),
      wage_month: formatDate(this.wageMonth, 'Y-m'),
      due_date: formatDate(this.dueDate, 'Y-m-d'),
      actual_payment_date: formatDate(this.actualPaymentDate, 'Y-m-d'),
      is_late: this.isLate,
      delay_days: this.delayDays,
      delay_months: this.delayMonths,
      interest: this.interest.toRupees(),
      interest_formatted: this.interest.format(),
      damages: this.damages.toRupees(),
      damages_formatted: this.damages.format(),
      total: this.total.toRupees(),
      total_formatted: this.total.format(),
      interest_rate_per_annum: this.interestRatePerAnnum,
      damages_basis: this.damagesBasis,
      damages_rate: this.damagesRate,
      damages_rate_unit: this.damagesRateUnit,
      damages_band: this.damagesBand,
      damages_capped_at_arrears: this.damagesCappedAtArrears,
      rate_version: this.rateVersion,
    };
  }
}

/**
 * Interest under section 7Q and damages under section 14B on a provident fund
 * contribution deposited after its due date.
 *
 * The two are cumulative, not alternatives - an employer in default pays both.
 */
export class EpfoPenaltyCalculator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: EpfoPenaltyInput): EpfoPenaltyResult {
    const contributionAmount = Money.from(input.contributionAmount);

    if (contributionAmount.isNegative()) {
      throw InvalidInputError.negative('Contribution amount');
    }

    const wageMonth = toDate(input.wageMonth);

    // The version in force is the one that governed the default, and a default
    // begins on its due date. A May 2023 contribution is judged by the slab scale
    // that stood in June 2023 even if the arithmetic is run in 2026, so the due
    // date - not today, and not the payment date - resolves the table.
    //
    // The due day is itself a versioned value, hence the two passes: read a
    // provisional due day from the month the default would fall in, use it to fix
    // the due date, then settle both against the table that date resolves.
    const provisional = this.rates.for('epfo-penalty', firstDayOfNextMonth(wageMonth));
    let dueDate = dueDateFor(wageMonth, provisional.int('due_day_of_following_month'));

    const table = this.rates.for('epfo-penalty', input.asOf ?? dueDate);
    dueDate = dueDateFor(wageMonth, table.int('due_day_of_following_month'));

    const paidOn = toDate(input.actualPaymentDate);
    const isLate = paidOn > dueDate;
    const delayDays = isLate ? daysBetween(dueDate, paidOn) : 0;

    const steps: Step[] = [
      new Step({
        label: 'Due date for the wage month',
        formula:
          `day ${table.int('due_day_of_following_month')} of the month following ` +
          `${formatDate(wageMonth, 'F Y')}`,
        citation: table.citation(),
        context: {
          wage_month: formatDate(wageMonth, 'Y-m'),
          due_date: formatDate(dueDate, 'Y-m-d'),
        },
      }),
    ];

    if (!isLate) {
      steps.push(
        new Step({
          label: 'No delay',
          amount: Money.zero(),
          formula: `paid ${formatDate(paidOn, 'd-m-Y')}, on or before ${formatDate(dueDate, 'd-m-Y')}`,
          citation: table.citation(),
        }),
      );

      return this.result(
        contributionAmount,
        wageMonth,
        dueDate,
        paidOn,
        false,
        0,
        0,
        Money.zero(),
        Money.zero(),
        contributionAmount,
        table,
        Number(table.get('damages_rate_per_month', 0) ?? 0),
        null,
        false,
        steps,
      );
    }

    // A part of a month counts as a whole one for the flat basis: the 2024
    // notification charges "1% per month of delay", and EPFO reads a fraction of a
    // month as a month.
    const delayMonths = Math.ceil(delayDays / 30);

    const interestRate = table.float('interest_rate_per_annum');
    const interest = contributionAmount.multiply(((interestRate / 100) * delayDays) / 365);

    steps.push(
      new Step({
        label: `Delay of ${delayDays} days (${delayMonths} month${delayMonths === 1 ? '' : 's'})`,
        formula: `${formatDate(dueDate, 'd-m-Y')} → ${formatDate(paidOn, 'd-m-Y')}`,
        citation: table.citation(),
        context: { delay_days: delayDays, delay_months: delayMonths },
      }),
      new Step({
        label: 'Interest under section 7Q',
        amount: interest,
        formula:
          `(${rateLabel(contributionAmount.toRupees())} × ${rateLabel(interestRate)}% × ${delayDays}) ÷ 365`,
        citation: table.citation(),
      }),
    );

    const basis = table.string('damages_basis');

    let damagesResult: { damages: Money; rate: number; band: string | null; step: Step };

    if (basis === 'flat_per_month') {
      damagesResult = flatDamages(contributionAmount, delayMonths, table);
    } else if (basis === 'slab_per_annum') {
      damagesResult = slabDamages(contributionAmount, delayDays, table);
    } else {
      throw InvalidInputError.unknownOption('damages basis', basis, ['flat_per_month', 'slab_per_annum']);
    }

    steps.push(damagesResult.step);

    // Section 14B's proviso: damages are a deterrent, not a multiplier. They
    // cannot exceed the arrears they are levied on, however long the default ran.
    let damages = damagesResult.damages;
    let capped = false;

    if (table.bool('damages_capped_at_arrears') && damages.greaterThan(contributionAmount)) {
      damages = contributionAmount;
      capped = true;

      steps.push(
        new Step({
          label: 'Damages capped at the amount of arrears',
          amount: damages,
          formula: `min(damages, ${rateLabel(contributionAmount.toRupees())})`,
          citation: table.citation(),
        }),
      );
    }

    const total = contributionAmount.add(interest, damages);

    steps.push(
      new Step({
        label: 'Total payable',
        amount: total,
        formula:
          `${rateLabel(contributionAmount.toRupees())} + ${rateLabel(interest.toRupees())} + ` +
          `${rateLabel(damages.toRupees())}`,
      }),
    );

    return this.result(
      contributionAmount,
      wageMonth,
      dueDate,
      paidOn,
      true,
      delayDays,
      delayMonths,
      interest,
      damages,
      total,
      table,
      damagesResult.rate,
      damagesResult.band,
      capped,
      steps,
    );
  }

  private result(
    contributionAmount: Money,
    wageMonth: Date,
    dueDate: Date,
    paidOn: Date,
    isLate: boolean,
    delayDays: number,
    delayMonths: number,
    interest: Money,
    damages: Money,
    total: Money,
    table: RateTable,
    damagesRate: number,
    damagesBand: string | null,
    capped: boolean,
    steps: Step[],
  ): EpfoPenaltyResult {
    const basis = table.string('damages_basis');

    return new EpfoPenaltyResult(
      contributionAmount,
      wageMonth,
      dueDate,
      paidOn,
      isLate,
      delayDays,
      delayMonths,
      interest,
      damages,
      total,
      table.float('interest_rate_per_annum'),
      basis,
      damagesRate,
      basis === 'flat_per_month' ? 'per_month' : 'per_annum',
      damagesBand,
      capped,
      formatDate(table.effectiveFrom, 'Y-m-d'),
      steps,
    );
  }
}

function flatDamages(
  amount: Money,
  delayMonths: number,
  table: RateTable,
): { damages: Money; rate: number; band: string | null; step: Step } {
  const rate = table.float('damages_rate_per_month');
  const damages = amount.multiply((rate / 100) * delayMonths);

  return {
    damages,
    rate,
    band: null,
    step: new Step({
      label: 'Damages under section 14B',
      amount: damages,
      formula:
        `${rateLabel(amount.toRupees())} × ${rateLabel(rate)}% × ${delayMonths} ` +
        `month${delayMonths === 1 ? '' : 's'}`,
      citation: table.citation(),
      context: { basis: 'flat_per_month', rate_per_month: rate },
    }),
  };
}

function slabDamages(
  amount: Money,
  delayDays: number,
  table: RateTable,
): { damages: Money; rate: number; band: string; step: Step } {
  // The old bands read "less than two months", "two months and above but less
  // than four", and so on, so the band is chosen on the exact length of the
  // default rather than on the ceiled month count the flat basis uses. Thirty-one
  // days is a month and a day, not two months, and belongs in the 5% band.
  const months = delayDays / 30;
  let rate: number | null = null;
  let band = '';

  for (const slab of table.array<Record<string, unknown>>('damages_slabs')) {
    const from = Number(slab.months_from);
    const to = slab.months_to === null || slab.months_to === undefined ? null : Number(slab.months_to);

    if (months < from || (to !== null && months >= to)) continue;

    rate = Number(slab.rate_per_annum);
    band = to === null ? `${rateLabel(from)} months and above` : `${rateLabel(from)} to under ${rateLabel(to)} months`;
    break;
  }

  if (rate === null) {
    throw InvalidInputError.outOfRange('Delay', 'within a damages slab', `${delayDays} days`);
  }

  const damages = amount.multiply(((rate / 100) * delayDays) / 365);

  return {
    damages,
    rate,
    band,
    step: new Step({
      label: `Damages under section 14B (${band} band)`,
      amount: damages,
      formula: `(${rateLabel(amount.toRupees())} × ${rateLabel(rate)}% × ${delayDays}) ÷ 365`,
      citation: table.citation(),
      context: { basis: 'slab_per_annum', rate_per_annum: rate, band },
    }),
  };
}

function dueDateFor(wageMonth: Date, dueDay: number): Date {
  const following = firstDayOfNextMonth(wageMonth);
  return utcDate(yearOf(following), monthOf(following), dueDay);
}

/** Interest under 7Q and damages under 14B on a delayed PF deposit. */
export function calculateEpfoPenalty(input: EpfoPenaltyInput, rates?: RateRepository): EpfoPenaltyResult {
  return new EpfoPenaltyCalculator(rates).calculate(input);
}

/**
 * Short alias. This is the documented public name - the per-tool npm package
 * `@crmleaf/epfoPenalty` re-exports it, and the README uses it - so it is API,
 * not sugar. bin/check-tool-contracts.php fails the build if it goes missing.
 */
export const epfoPenalty = calculateEpfoPenalty;
