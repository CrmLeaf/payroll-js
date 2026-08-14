/**
 * The TypeScript half of the carry-forward guard.
 *
 * This port is what runs in the browser, which is the more exposed of the two
 * surfaces: a visitor computing their own tax has no maintainer to ask. So the
 * disclosure PHP makes has to be made here too, and worded identically - two
 * implementations that agree on the figure but differ on the caveat have still
 * drifted.
 */

import { describe, expect, it } from 'vitest';
import { IncomeTaxCalculator } from '../src/calculators/income-tax.js';
import { Money } from '../src/money.js';
import { RateRepository } from '../src/rates/index.js';
import { financialYearOf } from '../src/dates.js';

describe('carrying a financial year forward', () => {
  const rates = new RateRepository();

  it('reports a table applied to a later year, and stays quiet inside its own', () => {
    const table = rates.for('income-tax', '2025-06-15');

    expect(table.isProvisionalFor(new Date('2025-06-15'))).toBe(false);
    expect(table.provisionalWarning(new Date('2025-06-15'))).toBeNull();

    const later = new Date('2027-06-15');
    expect(table.isProvisionalFor(later)).toBe(true);

    const warning = table.provisionalWarning(later);
    expect(warning).toContain('2025-26');
    expect(warning).toContain('2027-28');
  });

  it('never flags a table that is not dated by financial year', () => {
    // EPF rates are not annual, so carrying them forward assumes nothing.
    const epf = rates.for('epf');

    expect(epf.financialYear).toBeNull();
    expect(epf.isProvisionalFor(new Date('2030-01-01'))).toBe(false);
  });

  it('discloses the carry-forward in the result, asserted against today', () => {
    const today = new Date();
    const table = rates.for('income-tax');

    if (!table.isProvisionalFor(today)) {
      expect(table.financialYear).toBe(financialYearOf(today));
      return;
    }

    const result = new IncomeTaxCalculator().calculate({
      grossSalary: Money.fromRupees(1_200_000),
    });

    expect(result.notes).toContain(table.provisionalWarning(today));
  });

  it('resolves asOf the same way for() does', () => {
    // A second implementation of this rule would eventually disagree with the
    // first, and the disagreement would show up as a spurious warning.
    expect(RateRepository.asDate('2014-15').toISOString().slice(0, 10)).toBe('2014-04-01');
    expect(RateRepository.asDate('2014-09-01').toISOString().slice(0, 10)).toBe('2014-09-01');
  });
});
