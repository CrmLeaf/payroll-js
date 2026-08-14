import { describe, expect, it } from 'vitest';
import { Money, phpRound, rateLabel } from '../src/money.js';
import { InvalidMoneyError } from '../src/errors.js';

describe('Money', () => {
  it('holds paise as integers', () => {
    expect(Money.fromRupees(1234.56).paise).toBe(123456);
    expect(Money.fromPaise(123456).toRupees()).toBe(1234.56);
  });

  it('rounds rather than truncates on construction', () => {
    // (int) (0.07 * 100) is 6 in a naive implementation.
    expect(Money.fromRupees(0.07).paise).toBe(7);
    expect(Money.fromRupees('0.07').paise).toBe(7);
  });

  it.each([
    [0.5, 1],
    [-0.5, -1],
    [1.5, 2],
    [2.5, 3],
    [-2.5, -3],
    [2.4999999999999996, 3],
  ])('rounds %s half away from zero like PHP (%s)', (input, expected) => {
    expect(phpRound(input)).toBe(expected);
  });

  it('rejects values that are not numbers', () => {
    expect(() => Money.fromRupees('twelve')).toThrow(InvalidMoneyError);
    expect(() => Money.fromRupees(Number.NaN)).toThrow(InvalidMoneyError);
    expect(() => Money.fromRupees(1).divide(0)).toThrow(InvalidMoneyError);
  });

  it('rounds up to the whole rupee for ESI', () => {
    expect(Money.fromRupees(133.13).roundUpToRupee().toRupees()).toBe(134);
    expect(Money.fromRupees(134).roundUpToRupee().toRupees()).toBe(134);
  });

  it('rounds to ten rupees for section 288B', () => {
    expect(Money.fromRupees(61504).roundToTenRupees().toRupees()).toBe(61500);
    expect(Money.fromRupees(61505).roundToTenRupees().toRupees()).toBe(61510);
  });

  it('never returns a negative component from floorAtZero', () => {
    expect(Money.fromRupees(-500).floorAtZero().isZero()).toBe(true);
  });

  it('groups digits the Indian way', () => {
    expect(Money.fromRupees(1234567.89).format()).toBe('₹12,34,567.89');
    expect(Money.fromRupees(1000).format()).toBe('₹1,000.00');
    expect(Money.fromRupees(-1234567.89).format()).toBe('-₹12,34,567.89');
    expect(Money.fromRupees(45000).format(false)).toBe('45,000.00');
    expect(Money.fromRupees(45000).format(true, false)).toBe('₹45,000');
  });

  it('is immutable', () => {
    const original = Money.fromRupees(100);
    const doubled = original.multiply(2);

    expect(original.toRupees()).toBe(100);
    expect(doubled.toRupees()).toBe(200);
    expect(doubled).not.toBe(original);
  });

  it('accumulates 8.33% of the ceiling without drift', () => {
    // The EPS share is the classic place a float implementation loses a paisa.
    expect(Money.fromRupees(15000).percentage(8.33).paise).toBe(124950);
  });
});

describe('rateLabel', () => {
  it.each([
    [12, '12'],
    [8.33, '8.33'],
    [0.75, '0.75'],
    [3.25, '3.25'],
    [0, '0'],
    [20, '20'],
  ])('renders %s as %s', (input, expected) => {
    expect(rateLabel(input)).toBe(expected);
  });
});
