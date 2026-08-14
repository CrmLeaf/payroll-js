import {
  type DateInput,
  addDays,
  addMonths,
  atom,
  firstDayOfMonth,
  formatDate,
  toDate,
  utcDate,
  withDayClamped,
  year as yearOf,
} from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';
import { Money } from '../money.js';

export interface ComplianceCalendarInput {
  financialYear?: string;
  /** Obligation codes to keep; empty means all. */
  only?: string[];
  /** Swap the GST obligations for their quarterly QRMP variants. */
  qrmp?: boolean;
  asOf?: DateInput;
}

export interface ComplianceEventJson {
  date: string;
  code: string;
  title: string;
  authority: string;
  description: string;
  source: string;
  penalty: string | null;
  period: string | null;
  uid: string;
  context: Record<string, string | number | boolean>;
}

/**
 * One dated statutory obligation - a single square on the compliance calendar.
 *
 * The date is the *statutory* due date. Portals commonly accept the next working
 * day when it falls on a Sunday or a gazetted holiday, but shifting it here would
 * bake one organisation's holiday list into everybody's calendar, so the rule as
 * written is what is recorded and the adjustment is left to the caller.
 */
export class ComplianceEvent {
  constructor(
    readonly date: Date,
    readonly code: string,
    readonly title: string,
    readonly authority: string,
    readonly description: string,
    readonly source: string,
    readonly penalty: string | null = null,
    readonly period: string | null = null,
    readonly context: Record<string, string | number | boolean> = {},
  ) {}

  /**
   * A stable identifier derived from the obligation code and the due date, so
   * that regenerating the feed updates the existing entry in a subscriber's
   * calendar rather than duplicating it.
   */
  uid(): string {
    return `${this.code.toLowerCase().replace(/_/g, '-')}-${formatDate(this.date, 'Ymd')}@payroll-tools.crmleaf.app`;
  }

  isOn(date: Date): boolean {
    return formatDate(this.date, 'Y-m-d') === formatDate(date, 'Y-m-d');
  }

  toArray(): ComplianceEventJson {
    return {
      date: formatDate(this.date, 'Y-m-d'),
      code: this.code,
      title: this.title,
      authority: this.authority,
      description: this.description,
      source: this.source,
      penalty: this.penalty,
      period: this.period,
      uid: this.uid(),
      context: this.context,
    };
  }

  toJSON(): ComplianceEventJson {
    return this.toArray();
  }
}

export interface UnscheduledObligation {
  code: string;
  title: string;
  authority: string;
  reason: string;
}

/** A financial year's worth of dated statutory obligations. */
export class ComplianceCalendarResult extends Result {
  constructor(
    readonly financialYear: string,
    readonly periodStart: Date,
    readonly periodEnd: Date,
    readonly events: ComplianceEvent[],
    readonly unscheduled: UnscheduledObligation[],
    readonly qrmp: boolean,
    readonly generatedAt: Date,
    readonly source: string,
  ) {
    super();
  }

  /**
   * A calendar has no money in it. The headline "amount" is nil so the result
   * still satisfies the shape every other calculator returns.
   */
  get amount(): Money {
    return Money.zero();
  }

  static make(
    financialYear: string,
    periodStart: Date,
    periodEnd: Date,
    events: ComplianceEvent[],
    unscheduled: UnscheduledObligation[],
    qrmp: boolean,
    generatedAt: Date,
    source: string,
    steps: Step[],
  ): ComplianceCalendarResult {
    const result = new ComplianceCalendarResult(
      financialYear,
      periodStart,
      periodEnd,
      events,
      unscheduled,
      qrmp,
      generatedAt,
      source,
    );

    return result.withWorking(
      steps,
      [source, ...steps.map((entry) => entry.citation)].filter((entry): entry is string => Boolean(entry)),
    );
  }

  codes(): string[] {
    return [...new Set(this.events.map((event) => event.code))];
  }

  /** Everything falling in one calendar month, for a month grid. */
  forMonth(year: number, month: number): ComplianceEvent[] {
    return this.events.filter(
      (event) => event.date.getUTCFullYear() === year && event.date.getUTCMonth() + 1 === month,
    );
  }

  /** The next `count` obligations on or after `from`. */
  upcoming(from: Date = new Date(), count = 5): ComplianceEvent[] {
    const start = toDate(from);
    return this.events.filter((event) => event.date >= start).slice(0, count);
  }

  explain(): string {
    return (
      `${this.codes().length} obligation${this.codes().length === 1 ? '' : 's'} expanded to ` +
      `${this.events.length} dated event${this.events.length === 1 ? '' : 's'} for FY ${this.financialYear} (` +
      `${this.events.length === 0 ? '-' : formatDate(this.events[0].date, 'j M Y')} to ` +
      `${this.events.length === 0 ? '-' : formatDate(this.events[this.events.length - 1].date, 'j M Y')})` +
      `${this.qrmp ? ', GST filed quarterly under QRMP' : ''}`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      financial_year: this.financialYear,
      period_start: formatDate(this.periodStart, 'Y-m-d'),
      period_end: formatDate(this.periodEnd, 'Y-m-d'),
      qrmp: this.qrmp,
      generated_at: atom(this.generatedAt),
      source: this.source,
      event_count: this.events.length,
      codes: this.codes(),
      events: this.events.map((event) => event.toArray()),
      unscheduled: this.unscheduled,
    };
  }
}

type Rule = Record<string, unknown>;

/**
 * Expands the recurrence rules in the compliance-calendar rate table into
 * concrete dated events for a financial year.
 *
 * Not a calculator in the arithmetic sense, but it lives with them because the
 * problem is identical: a statutory rule, versioned by date, that has to be
 * applied to a period and then shown its working. Storing the calendar as rules
 * rather than as a list of dates is what lets FY 2019-20 and FY 2026-27 both be
 * generated from the same table, and what lets a rule change (the EPFO grace
 * period, say) be recorded as a new version instead of an edit.
 */
export class ComplianceCalendar {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  forFinancialYear(input: ComplianceCalendarInput = {}): ComplianceCalendarResult {
    const financialYear = input.financialYear ?? '2025-26';
    const only = input.only ?? [];
    const qrmp = input.qrmp ?? false;

    const start = parseFinancialYear(financialYear);
    const end = addDays(addMonths(start, 12), -1);

    const table = this.rates.for('compliance-calendar', input.asOf);
    const obligations = table.array<Rule>('obligations');

    const wanted = only.map((code) => code.toUpperCase());

    const events: ComplianceEvent[] = [];
    const unscheduled: UnscheduledObligation[] = [];
    const steps: Step[] = [];

    for (const obligation of obligations) {
      const code = String(obligation.code ?? '');

      if (wanted.length > 0 && !wanted.includes(code)) continue;

      let rule: Rule = obligation;
      let usedQrmp = false;

      // The QRMP variant overrides only the recurrence keys; the code, title,
      // authority, source and penalty stay as they are.
      if (qrmp && obligation.qrmp_variant && typeof obligation.qrmp_variant === 'object') {
        rule = { ...obligation, ...(obligation.qrmp_variant as Rule) };
        usedQrmp = true;
      }

      const generated = expand(rule, start, end, financialYear, usedQrmp);

      if (generated.length === 0) {
        unscheduled.push({
          code,
          title: String(obligation.title ?? code),
          authority: String(obligation.authority ?? ''),
          reason: String(obligation.note ?? 'No recurrence rule is recorded for this obligation.'),
        });
        continue;
      }

      events.push(...generated);

      steps.push(
        new Step({
          label: `${code} - ${String(obligation.title ?? code)}`,
          formula:
            `${String(rule.frequency ?? 'varies')}${usedQrmp ? ' (QRMP)' : ''} → ${generated.length} ` +
            `event${generated.length === 1 ? '' : 's'}`,
          citation: String(obligation.source ?? table.citation()),
          context: { first_due: formatDate(generated[0].date, 'Y-m-d') },
        }),
      );
    }

    if (wanted.length > 0 && events.length === 0 && unscheduled.length === 0) {
      throw InvalidInputError.unknownOption(
        'obligation code',
        wanted.join(', '),
        obligations.map((entry) => String(entry.code ?? '')),
      );
    }

    events.sort((a, b) => {
      const byDate = a.date.getTime() - b.date.getTime();
      return byDate !== 0 ? byDate : a.code.localeCompare(b.code);
    });

    return ComplianceCalendarResult.make(
      financialYear,
      start,
      end,
      events,
      unscheduled,
      qrmp,
      stamp(input.asOf),
      table.citation(),
      steps,
    );
  }
}

function expand(
  rule: Rule,
  start: Date,
  end: Date,
  financialYear: string,
  qrmp: boolean,
): ComplianceEvent[] {
  // Advance tax carries instalments alongside a "quarterly" frequency, so it has
  // to be recognised before the frequency switch.
  if (Array.isArray(rule.instalments)) {
    return fromInstalments(rule, start, financialYear);
  }

  switch (String(rule.frequency ?? 'varies')) {
    case 'monthly':
      return fromMonthly(rule, start, financialYear);
    case 'quarterly':
      return Array.isArray(rule.quarters)
        ? fromQuarters(rule, start, financialYear)
        : fromDerivedQuarters(rule, start, financialYear, qrmp);
    case 'annual':
      return fromAnnual(rule, end, financialYear);
    default:
      return [];
  }
}

/**
 * One event per month of the year, due `day` of the month `month_offset` months
 * after the period it relates to. The March event therefore lands in the
 * following financial year, which is correct: the obligation belongs to this
 * year's payroll even though the cheque is written in April.
 */
function fromMonthly(rule: Rule, start: Date, financialYear: string): ComplianceEvent[] {
  const day = Number(rule.day ?? 0);
  const offset = Number(rule.month_offset ?? 1);

  if (day < 1) return [];

  const events: ComplianceEvent[] = [];

  for (let i = 0; i < 12; i += 1) {
    const period = addMonths(start, i);
    const periodMonth = period.getUTCMonth() + 1;

    let effectiveDay = day;
    let effectiveOffset = offset;
    let note: string | null = null;

    for (const exception of exceptionsOf(rule)) {
      if (Number(exception.applies_to_month ?? 0) !== periodMonth) continue;

      effectiveDay = Number(exception.day ?? day);
      effectiveOffset = Number(exception.month_offset ?? offset);
      note = exception.note === undefined ? null : String(exception.note);
    }

    const due = withDayClamped(addMonths(period, effectiveOffset), effectiveDay);
    const label = formatDate(period, 'F Y');

    let description = `${titleOf(rule)} for ${label}.`;

    if (rule.note !== undefined) description += ` ${sentence(String(rule.note))}`;
    if (note !== null) description += ` ${sentence(note)}`;

    events.push(
      eventFrom(rule, due, description, label, {
        period_month: formatDate(period, 'Y-m'),
        financial_year: financialYear,
      }),
    );
  }

  return events;
}

/**
 * Quarters given explicitly in the table, each with its own MM-DD due date.
 *
 * The due date is resolved as the first occurrence of that MM-DD strictly after
 * the quarter closes. Q3 of FY 2025-26 closes on 31 December 2025 and is due
 * "01-31", which is 31 January 2026, not 31 January 2025 - a naive "MM-DD inside
 * the financial year" reading gets that one right by accident and Q4's "05-31"
 * badly wrong.
 */
function fromQuarters(rule: Rule, start: Date, financialYear: string): ComplianceEvent[] {
  const quarters = rule.quarters as Array<Record<string, unknown>>;
  const events: ComplianceEvent[] = [];

  quarters.forEach((quarter, index) => {
    const number = Number(quarter.quarter ?? index + 1);
    const [quarterStart, quarterEnd] = quarterBounds(start, number);

    const due = firstOccurrenceAfter(String(quarter.due), quarterEnd);
    const period =
      quarter.period !== undefined
        ? String(quarter.period)
        : `${formatDate(quarterStart, 'F')} to ${formatDate(quarterEnd, 'F')}`;

    const label = `Q${number} (${period}) of FY ${financialYear}`;

    events.push(
      eventFrom(rule, due, `${titleOf(rule)} for ${label}.`, label, {
        quarter: number,
        period_start: formatDate(quarterStart, 'Y-m-d'),
        period_end: formatDate(quarterEnd, 'Y-m-d'),
        financial_year: financialYear,
      }),
    );
  });

  return events;
}

/**
 * Quarters implied by a `day` plus `month_offset` rather than listed - the shape
 * the QRMP variants take. The offset counts from the month the quarter closes in,
 * so Q1 under QRMP falls due on the 13th of July.
 */
function fromDerivedQuarters(
  rule: Rule,
  start: Date,
  financialYear: string,
  qrmp: boolean,
): ComplianceEvent[] {
  const day = Number(rule.day ?? 0);
  const offset = Number(rule.month_offset ?? 1);

  if (day < 1) return [];

  const events: ComplianceEvent[] = [];

  for (let number = 1; number <= 4; number += 1) {
    const [quarterStart, quarterEnd] = quarterBounds(start, number);

    const due = withDayClamped(addMonths(firstDayOfMonth(quarterEnd), offset), day);

    const label = `Q${number} (${formatDate(quarterStart, 'F')} to ${formatDate(quarterEnd, 'F')}) of FY ${financialYear}`;

    let description = `${titleOf(rule)} for ${label}.`;
    if (qrmp) description += ' Filed quarterly under the QRMP scheme.';
    if (rule.note !== undefined) description += ` ${sentence(String(rule.note))}`;

    events.push(
      eventFrom(rule, due, description, label, {
        quarter: number,
        period_start: formatDate(quarterStart, 'Y-m-d'),
        period_end: formatDate(quarterEnd, 'Y-m-d'),
        financial_year: financialYear,
        qrmp,
      }),
    );
  }

  return events;
}

/**
 * A single event for the year. Annual obligations report on a year that has
 * closed - Form 16 for FY 2025-26 goes out in June 2026 - so the due date is the
 * first occurrence of the MM-DD after 31 March.
 */
function fromAnnual(rule: Rule, end: Date, financialYear: string): ComplianceEvent[] {
  if (rule.due === undefined) return [];

  const label = `FY ${financialYear}`;

  return [
    eventFrom(rule, firstOccurrenceAfter(String(rule.due), end), `${titleOf(rule)} for ${label}.`, label, {
      financial_year: financialYear,
    }),
  ];
}

/**
 * Advance tax instalments fall *inside* the year they relate to, unlike every
 * other periodic obligation here, so the MM-DD is resolved within the year rather
 * than after it: 15 June through to 15 March.
 */
function fromInstalments(rule: Rule, start: Date, financialYear: string): ComplianceEvent[] {
  const instalments = rule.instalments as Array<Record<string, unknown>>;

  return instalments.map((instalment, index) => {
    const due = dateWithinYear(String(instalment.due), start);
    const percent = Number(instalment.cumulative_percent ?? 0);
    const label = `Instalment ${index + 1} of FY ${financialYear}`;

    return eventFrom(
      rule,
      due,
      `${titleOf(rule)} - ${trimNumber(percent)}% of the estimated tax liability for FY ${financialYear} is ` +
        'payable cumulatively by this date.',
      label,
      {
        instalment: index + 1,
        cumulative_percent: percent,
        financial_year: financialYear,
      },
    );
  });
}

function eventFrom(
  rule: Rule,
  due: Date,
  description: string,
  period: string,
  context: Record<string, string | number | boolean>,
): ComplianceEvent {
  return new ComplianceEvent(
    due,
    String(rule.code ?? ''),
    titleOf(rule),
    String(rule.authority ?? ''),
    description,
    String(rule.source ?? ''),
    rule.penalty === undefined ? null : String(rule.penalty),
    period,
    context,
  );
}

function exceptionsOf(rule: Rule): Array<Record<string, unknown>> {
  return Array.isArray(rule.exceptions) ? (rule.exceptions as Array<Record<string, unknown>>) : [];
}

function titleOf(rule: Rule): string {
  return String(rule.title ?? rule.code ?? 'Obligation');
}

/**
 * Notes come out of the rate table with inconsistent terminal punctuation and get
 * concatenated into a description, so give them a full stop.
 */
function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed === '' || trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

function quarterBounds(financialYearStart: Date, quarter: number): [Date, Date] {
  const start = addMonths(financialYearStart, 3 * (quarter - 1));
  return [start, addDays(addMonths(start, 3), -1)];
}

function firstOccurrenceAfter(monthDay: string, after: Date): Date {
  const [month, day] = splitMonthDay(monthDay);

  let candidate = withDayClamped(utcDate(yearOf(after), month, 1), day);

  if (candidate <= after) {
    candidate = withDayClamped(utcDate(yearOf(candidate) + 1, month, 1), day);
  }

  return candidate;
}

/**
 * Resolve a MM-DD inside the financial year: April to December belong to the
 * opening calendar year, January to March to the closing one.
 */
function dateWithinYear(monthDay: string, financialYearStart: Date): Date {
  const [month, day] = splitMonthDay(monthDay);
  const year = yearOf(financialYearStart) + (month >= 4 ? 0 : 1);

  return withDayClamped(utcDate(year, month, 1), day);
}

function splitMonthDay(monthDay: string): [number, number] {
  const matched = /^(\d{1,2})-(\d{1,2})$/.exec(monthDay);

  if (!matched) {
    throw InvalidInputError.outOfRange('due date', 'in the form MM-DD', monthDay);
  }

  const month = Number(matched[1]);
  const day = Number(matched[2]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    throw InvalidInputError.outOfRange('due date', 'a real month and day', monthDay);
  }

  return [month, day];
}

function parseFinancialYear(financialYear: string): Date {
  const matched = /^(\d{4})-(\d{2})$/.exec(financialYear);

  if (!matched) {
    throw InvalidInputError.outOfRange('financialYear', 'in the form 2025-26', financialYear);
  }

  const start = Number(matched[1]);

  if (Number(matched[2]) !== (start + 1) % 100) {
    throw InvalidInputError.outOfRange(
      'financialYear',
      `a consecutive pair of years, e.g. ${start}-${String((start + 1) % 100).padStart(2, '0')}`,
      financialYear,
    );
  }

  return utcDate(start, 4, 1);
}

/**
 * The iCalendar DTSTAMP. Taken from `asOf` when one is given so that regenerating
 * the same year produces a byte-identical feed - a subscription URL that changes
 * on every fetch defeats client-side caching.
 */
function stamp(asOf: DateInput): Date {
  return toDate(asOf);
}

function trimNumber(value: number): string {
  return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** A financial year's worth of dated statutory obligations. */
export function complianceCalendar(
  input: ComplianceCalendarInput = {},
  rates?: RateRepository,
): ComplianceCalendarResult {
  return new ComplianceCalendar(rates).forFinancialYear(input);
}
