/**
 * The slice of `DateTimeImmutable` this library actually leans on.
 *
 * Everything is pinned to UTC midnight. Payroll dates are calendar dates, not
 * instants, and letting the host's timezone shift them is how a settlement dated
 * 1 April quietly lands in the previous financial year for a user in Honolulu.
 */

export type DateInput = Date | string | null | undefined;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function utcDate(year: number, month: number, day: number): Date {
  // Month is 1-based here; JS normalises overflow the same way PHP does, so
  // 2025-02-31 becomes 3 March in both.
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export function today(): Date {
  const now = new Date();
  return utcDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Parse the date shapes a caller may reasonably supply. */
export function toDate(input: DateInput): Date {
  if (input instanceof Date) {
    return utcDate(input.getUTCFullYear(), input.getUTCMonth() + 1, input.getUTCDate());
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();

    const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(trimmed);
    if (ymd) {
      return utcDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
    }

    const ym = /^(\d{4})-(\d{1,2})$/.exec(trimmed);
    if (ym) {
      return utcDate(Number(ym[1]), Number(ym[2]), 1);
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return utcDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
    }

    throw new TypeError(`Cannot read "${input}" as a date.`);
  }

  return today();
}

export const year = (date: Date): number => date.getUTCFullYear();
export const month = (date: Date): number => date.getUTCMonth() + 1;
export const day = (date: Date): number => date.getUTCDate();

export function daysInMonth(date: Date): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

export function addDays(date: Date, days: number): Date {
  return utcDate(year(date), month(date), day(date) + days);
}

export function addMonths(date: Date, months: number): Date {
  return utcDate(year(date), month(date) + months, day(date));
}

export function firstDayOfMonth(date: Date): Date {
  return utcDate(year(date), month(date), 1);
}

export function firstDayOfNextMonth(date: Date): Date {
  return utcDate(year(date), month(date) + 1, 1);
}

/**
 * Set the day of the month, clamping where the month is short - "the 30th" in
 * February means the 28th.
 */
export function withDayClamped(date: Date, dayOfMonth: number): Date {
  const first = firstDayOfMonth(date);
  return utcDate(year(first), month(first), Math.min(dayOfMonth, daysInMonth(first)));
}

/** Whole days between two dates, always non-negative, as `diff()->days` gives. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round(Math.abs(to.getTime() - from.getTime()) / 86_400_000);
}

export interface YearsMonthsDays {
  years: number;
  months: number;
  days: number;
}

/** The calendar difference `DateInterval` reports, borrowing from the shorter month. */
export function diffYearsMonthsDays(from: Date, to: Date): YearsMonthsDays {
  let years = year(to) - year(from);
  let months = month(to) - month(from);
  let days = day(to) - day(from);

  if (days < 0) {
    months -= 1;
    const borrowFrom = utcDate(year(to), month(to) - 1, 1);
    days += daysInMonth(borrowFrom);
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  return { years, months, days };
}

/**
 * The `format()` tokens this library uses. Deliberately not a general date
 * formatter - every token here appears in a step, a citation or a result key
 * somewhere in the PHP package, and the output has to match it character for
 * character.
 */
export function formatDate(date: Date, pattern: string): string {
  let out = '';

  for (const token of pattern) {
    switch (token) {
      case 'Y':
        out += String(year(date));
        break;
      case 'y':
        out += String(year(date) % 100).padStart(2, '0');
        break;
      case 'm':
        out += String(month(date)).padStart(2, '0');
        break;
      case 'n':
        out += String(month(date));
        break;
      case 'd':
        out += String(day(date)).padStart(2, '0');
        break;
      case 'j':
        out += String(day(date));
        break;
      case 'F':
        out += MONTH_NAMES[month(date) - 1];
        break;
      case 'M':
        out += MONTH_NAMES[month(date) - 1].slice(0, 3);
        break;
      case 't':
        out += String(daysInMonth(date));
        break;
      default:
        out += token;
    }
  }

  return out;
}

/** The ISO-8601 stamp `DateTimeInterface::ATOM` produces, at UTC. */
export function atom(date: Date): string {
  return `${formatDate(date, 'Y-m-d')}T00:00:00+00:00`;
}

/** Indian financial years run April to March. */
export function financialYearStart(financialYear: string): Date {
  const matched = /^(\d{4})-(\d{2,4})$/.exec(financialYear);
  if (!matched) {
    throw new TypeError(`"${financialYear}" is not a financial year. Expected a label like "2025-26".`);
  }
  return utcDate(Number(matched[1]), 4, 1);
}

export function financialYearOf(date: Date): string {
  const calendarYear = year(date);
  const startYear = month(date) >= 4 ? calendarYear : calendarYear - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
