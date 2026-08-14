import { RateNotFoundError } from '../errors.js';
import { Money } from '../money.js';
import {
  type DateInput,
  financialYearOf,
  financialYearStart,
  formatDate,
  toDate,
} from '../dates.js';
import {
  RATES_CHECKSUM,
  RATE_TABLES,
  RATE_TABLE_KEYS,
  type RateTableDocument,
} from './tables.js';

export { RATES_CHECKSUM, RATE_TABLES, RATE_TABLE_KEYS };
export type { RateTableDocument };

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * One version of one rate table, already resolved for a given date.
 *
 * Callers never pick a version themselves - they ask the repository for a key
 * and a date and get this back. That keeps "which slab applied in March 2024" a
 * data question rather than a branching question inside a calculator.
 */
export class RateTable {
  constructor(
    readonly key: string,
    readonly title: string,
    readonly statute: string,
    readonly source: string,
    readonly effectiveFrom: Date,
    readonly effectiveTo: Date | null,
    private readonly values: Record<string, unknown>,
    readonly notes: readonly string[] = [],
    readonly financialYear: string | null = null,
  ) {}

  /**
   * True when this version names a financial year and is being applied to a
   * date in a later one.
   *
   * A Finance Act arrives after the year it governs has begun, so the newest
   * income tax version is left open-ended rather than expiring on 31 March -
   * otherwise every calculator called without an explicit date would start
   * throwing the moment the financial year turned over. The cost of that choice
   * is that last year's slabs quietly become this year's default, so callers
   * need a way to know it happened. This is that way: true means the figures
   * are a carry-forward assumption, not a notified rate, and should be verified
   * before anything is filed on them.
   */
  isProvisionalFor(date: Date): boolean {
    if (this.financialYear === null) return false;

    return financialYearOf(date) !== this.financialYear;
  }

  /**
   * A caller-facing warning when this version is a carry-forward, or null when
   * the rates are the notified ones for the date.
   */
  provisionalWarning(date: Date): string | null {
    if (!this.isProvisionalFor(date)) return null;

    const current = financialYearOf(date);

    return (
      `Rates for FY ${this.financialYear} are being applied to a date in FY ${current}, ` +
      `because no version has been published for FY ${current} yet. Verify against the ` +
      'current Finance Act before relying on this figure for filing.'
    );
  }

  /** Read a value using dot notation, e.g. `get('new_regime.standard_deduction')`. */
  get(path: string): unknown;
  get<T>(path: string, fallback: T): unknown | T;
  get(path: string, ...fallback: unknown[]): unknown {
    let value: unknown = this.values;

    for (const segment of path.split('.')) {
      if (typeof value !== 'object' || value === null || !(segment in (value as object))) {
        if (fallback.length > 0) {
          return fallback[0];
        }
        throw RateNotFoundError.missingPath(this.key, path);
      }
      value = (value as Record<string, unknown>)[segment];
    }

    return value;
  }

  has(path: string): boolean {
    const sentinel = Symbol('missing');
    return this.get(path, sentinel) !== sentinel;
  }

  /**
   * Read a monetary value. Rate tables store paise, so this is the only correct
   * way to pull one out - `get()` would hand back a raw integer that is easy to
   * mistake for rupees.
   */
  money(path: string): Money {
    const value = this.get(path);

    if (typeof value !== 'number') {
      throw RateNotFoundError.notMonetary(this.key, path, typeName(value));
    }

    return Money.fromPaise(value);
  }

  float(path: string): number {
    const value = this.get(path);

    if (typeof value !== 'number' && (typeof value !== 'string' || !Number.isFinite(Number(value)))) {
      throw RateNotFoundError.notNumeric(this.key, path, typeName(value));
    }

    return Number(value);
  }

  int(path: string): number {
    return Math.trunc(this.float(path));
  }

  bool(path: string): boolean {
    return Boolean(this.get(path));
  }

  string(path: string): string {
    const value = this.get(path);
    return value === null || typeof value === 'object' ? '' : String(value);
  }

  array<T = unknown>(path: string): T[] {
    const value = this.get(path);

    if (typeof value !== 'object' || value === null) {
      throw RateNotFoundError.notArray(this.key, path, typeName(value));
    }

    return value as T[];
  }

  /** Objects keyed by name - the professional tax state map, the age bands. */
  record<T = unknown>(path: string): Record<string, T> {
    const value = this.get(path);

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw RateNotFoundError.notArray(this.key, path, typeName(value));
    }

    return value as Record<string, T>;
  }

  all(): Record<string, unknown> {
    return this.values;
  }

  /** A citation string suitable for dropping into a Step. */
  citation(): string {
    return `${this.statute} - ${this.source}`;
  }

  coversDate(date: Date): boolean {
    if (date < this.effectiveFrom) return false;
    return this.effectiveTo === null || date <= this.effectiveTo;
  }
}

/**
 * Resolves a rate table key plus a date to the version that was in force.
 *
 * Statutory rates change, and payroll routinely recomputes the past - a revised
 * F&F six months after separation, an arrear paid in a later year, an audit of
 * last year's challans. So nothing here is "the current rate"; everything is
 * "the rate on this date", and the date defaults to today only as a courtesy.
 */
export class RateRepository {
  private readonly resolved = new Map<string, RateTable>();

  constructor(private readonly documents: Record<string, RateTableDocument> = RATE_TABLES) {}

  /** The rate table for `key` in force on `on`. */
  for(key: string, on: DateInput = null): RateTable {
    const date = RateRepository.normaliseDate(on);
    const cacheKey = `${key}@${formatDate(date, 'Y-m-d')}`;

    const cached = this.resolved.get(cacheKey);
    if (cached) return cached;

    const document = this.load(key);

    for (const version of document.versions ?? []) {
      const from = toDate(version.effective_from);
      const to = version.effective_to ? toDate(version.effective_to) : null;

      if (date < from || (to !== null && date > to)) {
        continue;
      }

      const table = new RateTable(
        key,
        String(document.title ?? key),
        String(document.statute ?? ''),
        String(version.source ?? ''),
        from,
        to,
        version.values ?? {},
        document.notes ?? [],
        version.financial_year === undefined ? null : String(version.financial_year),
      );

      this.resolved.set(cacheKey, table);
      return table;
    }

    throw RateNotFoundError.noVersionForDate(key, formatDate(date, 'Y-m-d'));
  }

  /** Every version of a table, newest first. */
  versions(key: string): RateTable[] {
    const document = this.load(key);

    return (document.versions ?? [])
      .map(
        (version) =>
          new RateTable(
            key,
            String(document.title ?? key),
            String(document.statute ?? ''),
            String(version.source ?? ''),
            toDate(version.effective_from),
            version.effective_to ? toDate(version.effective_to) : null,
            version.values ?? {},
            document.notes ?? [],
            version.financial_year === undefined ? null : String(version.financial_year),
          ),
      )
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  }

  keys(): string[] {
    return Object.keys(this.documents).sort();
  }

  static financialYearStart(financialYear: string): Date {
    try {
      return financialYearStart(financialYear);
    } catch {
      throw RateNotFoundError.badFinancialYear(financialYear);
    }
  }

  static financialYearOf(date: Date): string {
    return financialYearOf(date);
  }

  private load(key: string): RateTableDocument {
    const document = this.documents[key];
    if (!document) {
      throw RateNotFoundError.missingTable(key);
    }
    return document;
  }

  /**
   * The date an `asOf` argument means, resolved the same way `for()` resolves
   * it. Public because a caller that has to reason about the resolved date - to
   * ask a table whether it is provisional for it, say - must ask the same
   * question `for()` asked, and a second implementation would eventually give a
   * different answer.
   */
  static asDate(on: DateInput): Date {
    if (typeof on === 'string' && /^\d{4}-\d{2}$/.test(on) && Number(on.slice(5, 7)) > 12) {
      // A financial-year label such as "2025-26" is accepted wherever a date is.
      return financialYearStart(on);
    }

    return toDate(on);
  }

  private static normaliseDate(on: DateInput): Date {
    return RateRepository.asDate(on);
  }
}

/** The default repository. Calculators share it so tables are parsed once. */
export const defaultRates = new RateRepository();
