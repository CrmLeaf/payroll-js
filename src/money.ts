import { InvalidMoneyError } from './errors.js';

/**
 * PHP's `round()` reproduced, because the two libraries have to agree to the
 * paisa.
 *
 * Two things separate it from `Math.round`. It rounds halves away from zero
 * rather than towards positive infinity, so −0.5 is −1 and not −0. And before
 * rounding it corrects the value to the fifteen significant digits floating
 * point can actually vouch for, which is what stops 8.33% of ₹15,000 arriving
 * as 124949.99999999999 and being rounded down to a paisa less than the EPS
 * ceiling.
 */
export function phpRound(value: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return value;
  }

  let tmp = value;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const precisionPlaces = 14 - magnitude;

  // PHP pre-rounds only where the correction is meaningful: values of at least
  // 1 (below that there is nothing to correct at integer precision) and below
  // 1e14 (above that the double has no spare digits anyway).
  if (precisionPlaces > 0 && precisionPlaces < 15) {
    const corrected = Number(value.toPrecision(15));
    if (Number.isFinite(corrected)) {
      tmp = corrected;
    }
  }

  return tmp >= 0 ? Math.floor(tmp + 0.5) : Math.ceil(tmp - 0.5);
}

export interface MoneyJson {
  paise: number;
  rupees: number;
  formatted: string;
}

/**
 * An immutable rupee amount held as an integer number of paise.
 *
 * Payroll is full of thirds and sevenths - a gratuity divides by 26, EPS is
 * 8.33%, a monthly TDS instalment is an annual figure over 12. Doing that in
 * floats accumulates error that eventually shows up as a one-rupee mismatch on
 * an ECR challan, so every amount here is an integer of paise and division
 * rounds explicitly rather than silently.
 */
export class Money {
  readonly paise: number;

  private constructor(paise: number) {
    this.paise = paise;
    Object.freeze(this);
  }

  static fromPaise(paise: number): Money {
    return new Money(Math.trunc(paise));
  }

  static fromRupees(rupees: number | string): Money {
    let value: number;

    if (typeof rupees === 'string') {
      const trimmed = rupees.trim();
      if (trimmed === '' || !Number.isFinite(Number(trimmed))) {
        throw InvalidMoneyError.notNumeric(rupees);
      }
      value = Number(trimmed);
    } else {
      value = rupees;
    }

    if (!Number.isFinite(value)) {
      throw InvalidMoneyError.notFinite();
    }

    // Round before truncating: (0.07 * 100) | 0 is 6, not 7.
    return new Money(phpRound(value * 100));
  }

  static zero(): Money {
    return new Money(0);
  }

  /** Coerce the shapes a browser form or a JSON payload can hand over. */
  static from(value: Money | number | string): Money {
    return value instanceof Money ? value : Money.fromRupees(value);
  }

  add(...others: Money[]): Money {
    let total = this.paise;
    for (const other of others) {
      total += other.paise;
    }
    return new Money(total);
  }

  subtract(...others: Money[]): Money {
    let total = this.paise;
    for (const other of others) {
      total -= other.paise;
    }
    return new Money(total);
  }

  /** Multiply by a scalar, rounding half away from zero to the nearest paisa. */
  multiply(factor: number): Money {
    return new Money(phpRound(this.paise * factor));
  }

  /** Apply a percentage, e.g. `.percentage(8.33)` for the EPS share. */
  percentage(percent: number): Money {
    return this.multiply(percent / 100);
  }

  divide(divisor: number): Money {
    if (divisor === 0) {
      throw InvalidMoneyError.divisionByZero();
    }
    return new Money(phpRound(this.paise / divisor));
  }

  /**
   * The smaller of this and the given amounts - the shape almost every
   * statutory ceiling takes ("least of the following").
   */
  min(...others: Money[]): Money {
    let lowest: Money = this;
    for (const other of others) {
      if (other.paise < lowest.paise) {
        lowest = other;
      }
    }
    return lowest;
  }

  max(...others: Money[]): Money {
    let highest: Money = this;
    for (const other of others) {
      if (other.paise > highest.paise) {
        highest = other;
      }
    }
    return highest;
  }

  /**
   * Clamp negatives to zero. A deduction that exceeds earnings produces a
   * recovery elsewhere, never a negative component.
   */
  floorAtZero(): Money {
    return this.paise < 0 ? Money.zero() : this;
  }

  /**
   * Round up to the next whole rupee. ESI contributions are required to be
   * rounded this way for both shares.
   */
  roundUpToRupee(): Money {
    return new Money(Math.ceil(this.paise / 100) * 100);
  }

  /**
   * Round to the nearest whole rupee, halves away from zero. TDS is deducted in
   * whole rupees.
   */
  roundToRupee(): Money {
    return new Money(phpRound(this.paise / 100) * 100);
  }

  /**
   * Round to the nearest multiple of ten rupees, as section 288B requires for
   * the final tax figure.
   */
  roundToTenRupees(): Money {
    return new Money(phpRound(this.paise / 1000) * 1000);
  }

  isZero(): boolean {
    return this.paise === 0;
  }

  isPositive(): boolean {
    return this.paise > 0;
  }

  isNegative(): boolean {
    return this.paise < 0;
  }

  equals(other: Money): boolean {
    return this.paise === other.paise;
  }

  greaterThan(other: Money): boolean {
    return this.paise > other.paise;
  }

  greaterThanOrEqual(other: Money): boolean {
    return this.paise >= other.paise;
  }

  lessThan(other: Money): boolean {
    return this.paise < other.paise;
  }

  lessThanOrEqual(other: Money): boolean {
    return this.paise <= other.paise;
  }

  toRupees(): number {
    return this.paise / 100;
  }

  /** Indian digit grouping: 12,34,567.89 rather than 1,234,567.89. */
  format(symbol = true, decimals = true): string {
    const negative = this.paise < 0;
    const absolute = Math.abs(this.paise);

    const whole = Math.trunc(absolute / 100);
    const fraction = absolute % 100;

    let digits = String(whole);
    if (digits.length > 3) {
      const last3 = digits.slice(-3);
      const rest = digits.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
      digits = `${rest},${last3}`;
    }

    let formatted = digits;
    if (decimals) {
      formatted += `.${String(fraction).padStart(2, '0')}`;
    }

    return `${negative ? '-' : ''}${symbol ? '₹' : ''}${formatted}`;
  }

  toString(): string {
    return this.format();
  }

  toJSON(): MoneyJson {
    return { paise: this.paise, rupees: this.toRupees(), formatted: this.format() };
  }
}

/** `₹` amounts arrive from HTML inputs as strings; this is the one funnel. */
export const money = (value: Money | number | string): Money => Money.from(value);

/**
 * Trim a rate to its shortest exact form: 10 rather than 10.00, 8.33 as is.
 * Mirrors the `rtrim(rtrim(number_format(...)))` idiom the PHP calculators use
 * so the working reads identically on both sides.
 */
export function rateLabel(rate: number): string {
  const fixed = rate.toFixed(2);
  return fixed.replace(/0+$/, '').replace(/\.$/, '');
}
