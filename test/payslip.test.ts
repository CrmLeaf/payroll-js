import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/errors.js';
import { Money } from '../src/money.js';
import {
  PayslipResult,
  type PayslipInput,
  calculatePayslip,
  payslip as payslipAlias,
} from '../src/calculators/payslip.js';

/**
 * The same cases as PayrollCore's PayslipGeneratorTest, with the same inputs and
 * the same expected paise.
 *
 * Pinned to FY 2025-26. The income tax table's newest version expires on 31 March
 * 2026 and the professional tax table's oldest begins on 1 April 2025, so this is
 * the only window in which every table this generator touches has a version in
 * force.
 */
const AS_OF = '2025-08-01';

function slip(overrides: Partial<PayslipInput> = {}): PayslipResult {
  return calculatePayslip({
    employeeName: 'Asha Menon',
    monthlyGross: 75_000,
    monthlyBasic: 30_000,
    payMonth: '2025-08-01',
    daysPayable: 31,
    lopDays: 0,
    state: 'Karnataka',
    asOf: AS_OF,
    ...overrides,
  });
}

const sum = (lines: Array<[string, Money]>): Money =>
  lines.reduce((carry, [, amount]) => carry.add(amount), Money.zero());

describe('a wage slip for a full month', () => {
  /**
   * ₹75,000 gross on a ₹30,000 basic, all 31 days of August 2025 paid, in
   * Karnataka, worked through by hand:
   *
   *   basic                                        30,000.00
   *   HRA                 50% × 30,000             15,000.00
   *   special allowance   75,000 − 30,000 − 15,000 30,000.00
   *   gross                                        75,000.00
   *
   *   PF (employee)       12% × min(30,000, 15,000) 1,800.00
   *   ESI                 nil, ₹75,000 is over the ₹21,000 wage limit
   *   professional tax    Karnataka, above ₹25,000     200.00
   *   TDS                 nil, ₹9,00,000 a year is inside the 87A rebate
   *   net                 75,000 − 2,000            73,000.00
   */
  it('itemises a Karnataka payroll to the paisa', () => {
    const result = slip();

    expect(result.employeeName).toBe('Asha Menon');
    expect(result.employeeCode).toBe('EMP-0001');
    expect(result.toArray().pay_month).toBe('2025-08');

    expect(result.daysInMonth).toBe(31);
    expect(result.daysPayable).toBe(31);
    expect(result.lopDays).toBe(0);
    expect(result.paidDays).toBe(31);

    expect(result.basic.paise).toBe(30_00_000);
    expect(result.hra.paise).toBe(15_00_000);
    expect(result.specialAllowance.paise).toBe(30_00_000);
    expect(result.grossEarnings.paise).toBe(75_00_000);

    expect(result.providentFund.paise).toBe(1_80_000);
    expect(result.stateInsurance.paise).toBe(0);
    expect(result.stateInsuranceApplicable).toBe(false);
    expect(result.professionalTax.paise).toBe(20_000);
    expect(result.tds.paise).toBe(0);
    expect(result.totalDeductions.paise).toBe(2_00_000);

    expect(result.netPay.paise).toBe(73_00_000);
    expect(result.netPayInWords).toBe('Rupees Seventy Three Thousand Only');
  });
});

describe('loss of pay, prorated on the month’s own length', () => {
  /**
   * Two days of loss of pay costs more in February than in August, because a wage
   * month is divided by its own length and never by a flat thirty.
   */
  const cases: Array<[string, string, number, number, number, number, number]> = [
    // (75,000 × 26) ÷ 28 = 69,642.857…, and (30,000 × 26) ÷ 28 = 27,857.142…
    ['february, 28 days', '2026-02-01', 28, 2, 26, 69_64_286, 27_85_714],
    // (75,000 × 28) ÷ 30 lands exactly on 70,000.
    ['september, 30 days', '2025-09-01', 30, 2, 28, 70_00_000, 28_00_000],
    // (75,000 × 29) ÷ 31 = 70,161.290…
    ['august, 31 days', '2025-08-01', 31, 2, 29, 70_16_129, 28_06_452],
    ['february, none lost', '2026-02-01', 28, 0, 28, 75_00_000, 30_00_000],
    ['september, none lost', '2025-09-01', 30, 0, 30, 75_00_000, 30_00_000],
    ['august, none lost', '2025-08-01', 31, 0, 31, 75_00_000, 30_00_000],
  ];

  for (const [name, payMonth, days, lopDays, paidDays, grossPaise, basicPaise] of cases) {
    it(`divides by the month itself: ${name}`, () => {
      const result = slip({ payMonth, daysPayable: days, lopDays });

      expect(result.daysInMonth).toBe(days);
      expect(result.paidDays).toBe(paidDays);
      expect(result.grossEarnings.paise).toBe(grossPaise);
      expect(result.basic.paise).toBe(basicPaise);
    });
  }

  /**
   * The proration is a line of the working in its own right. A slip that quietly
   * pays 26/28ths of a salary and prints only the answer is the commonest payroll
   * support ticket there is.
   */
  it('shows the proration as a step of its own', () => {
    const result = slip({ payMonth: '2026-02-01', daysPayable: 28, lopDays: 2 });

    const labels = result.workings.map((step) => step.label);
    const formulae = result.workings.map((step) => step.formula ?? '').join(' | ');

    expect(labels).toContain('Gross prorated for 2 days of loss of pay');
    expect(labels).toContain('Wage month February 2026');
    expect(formulae).toContain('(₹75,000.00 × 26) ÷ 28');
  });

  /**
   * The form ships a days-payable default of 31, because most months have 31
   * days. February must not therefore pay 31/28ths of a salary.
   */
  it('caps days payable at the month itself, and says so', () => {
    const result = slip({ payMonth: '2026-02-01' });

    expect(result.daysPayable).toBe(28);
    expect(result.paidDays).toBe(28);
    expect(result.grossEarnings.paise).toBe(75_00_000);
    expect(result.notes.join(' ')).toContain('February 2026 has only 28 days');
  });
});

describe('the earnings column, which an employee adds up first', () => {
  const cases: Array<[string, number, number, string, number, number]> = [
    ['full month', 75_000, 30_000, '2025-08-01', 31, 0],
    ['february, two days lost', 75_000, 30_000, '2026-02-01', 28, 2],
    ['september, five days lost', 75_000, 30_000, '2025-09-01', 30, 5],
    ['awkward thirds', 55_555, 22_222, '2025-08-01', 31, 7],
    ['basic is the whole gross', 40_000, 40_000, '2025-08-01', 31, 3],
    ['basic is two thirds of gross', 30_000, 20_000, '2025-11-01', 30, 1],
    ['a single paid day', 75_000, 30_000, '2025-08-01', 31, 30],
    ['nothing paid at all', 75_000, 30_000, '2025-08-01', 31, 31],
  ];

  for (const [name, monthlyGross, monthlyBasic, payMonth, daysPayable, lopDays] of cases) {
    it(`reconstructs the gross exactly: ${name}`, () => {
      const result = slip({ monthlyGross, monthlyBasic, payMonth, daysPayable, lopDays });

      expect(result.basic.add(result.hra, result.specialAllowance).paise).toBe(
        result.grossEarnings.paise,
      );
      expect(result.specialAllowance.isNegative()).toBe(false);
      expect(sum(result.earningLines()).paise).toBe(result.grossEarnings.paise);
    });
  }

  it('reconciles both columns to the net', () => {
    const result = slip({ monthlyGross: 18_000, monthlyBasic: 9_000, lopDays: 3 });

    const earnings = sum(result.earningLines());
    const deductions = sum(result.deductionLines());

    expect(earnings.paise).toBe(result.grossEarnings.paise);
    expect(deductions.paise).toBe(result.totalDeductions.paise);
    expect(earnings.subtract(deductions).paise).toBe(result.netPay.paise);
  });
});

describe('the statutory deductions', () => {
  /**
   * Delhi has never enacted a professional tax. That is a valid nil line, not an
   * unsupported state and not an exception.
   */
  it('deducts no professional tax in a state that levies none', () => {
    const result = slip({ state: 'Delhi' });

    expect(result.state).toBe('Delhi');
    expect(result.professionalTax.paise).toBe(0);
    expect(result.professionalTaxDetail.levied).toBe(false);

    // Only PF is left, so the net is ₹200 higher than the Karnataka slip.
    expect(result.totalDeductions.paise).toBe(1_80_000);
    expect(result.netPay.paise).toBe(73_20_000);

    expect(result.deductionLines().map(([label]) => label)).not.toContain(
      'Professional tax (Delhi)',
    );
  });

  /**
   * Maharashtra charges ₹300 in February so that the year lands on the ₹2,500
   * Article 276 cap, which is why the pay month's number has to reach the
   * professional tax calculator rather than a hardcoded April.
   */
  for (const [name, payMonth, daysPayable, expected] of [
    ['an ordinary month', '2025-08-01', 31, 20_000],
    ['february', '2026-02-01', 28, 30_000],
  ] as Array<[string, string, number, number]>) {
    it(`lets the wage month drive the Maharashtra schedule: ${name}`, () => {
      expect(slip({ payMonth, daysPayable, state: 'Maharashtra' }).professionalTax.paise).toBe(
        expected,
      );
    });
  }

  /**
   * ESI bites below the ₹21,000 wage limit and not a rupee above it. The employee
   * share is 0.75% of the wages actually earned, rounded up to the whole rupee as
   * rule 51 requires.
   */
  const esiCases: Array<[string, number, number, boolean, number, number]> = [
    // 0.75% × 18,000 = 135.00; 3.25% × 18,000 = 585.00.
    ['well below the limit', 18_000, 9_000, true, 13_500, 58_500],
    // 0.75% × 21,000 = 157.50, rounded up to 158; 3.25% = 682.50 → 683.
    ['exactly on the limit', 21_000, 10_000, true, 15_800, 68_300],
    ['one rupee over the limit', 21_001, 10_000, false, 0, 0],
    ['far over the limit', 75_000, 30_000, false, 0, 0],
  ];

  for (const [name, monthlyGross, monthlyBasic, applicable, employee, employer] of esiCases) {
    it(`applies ESI only below the wage limit: ${name}`, () => {
      const result = slip({ monthlyGross, monthlyBasic });

      expect(result.stateInsuranceApplicable).toBe(applicable);
      expect(result.stateInsurance.paise).toBe(employee);
      expect(result.employerEsi.paise).toBe(employer);
    });
  }

  /**
   * Coverage is decided on the contracted monthly wage, the contribution on what
   * was earned. Deciding coverage on the prorated figure would sign people up and
   * drop them month by month.
   */
  it('keeps ESI coverage through a month of loss of pay', () => {
    const result = slip({
      monthlyGross: 18_000,
      monthlyBasic: 9_000,
      payMonth: '2026-02-01',
      daysPayable: 28,
      lopDays: 14,
    });

    expect(result.stateInsuranceApplicable).toBe(true);
    expect(result.grossEarnings.paise).toBe(9_00_000);
    // 0.75% × 9,000 = 67.50, rounded up to ₹68.
    expect(result.stateInsurance.paise).toBe(6_800);
  });

  it('reports the employer contributions without deducting them', () => {
    const result = slip();

    // 12% of the ₹15,000 ceiling is ₹1,800; EPS takes min(8.33% × 15,000, ₹1,250)
    // = ₹1,250 of it and EPF the ₹550 remainder. EDLI is 0.5% of ₹15,000 = ₹75.
    expect(result.employerEps.paise).toBe(1_25_000);
    expect(result.employerEpf.paise).toBe(55_000);
    expect(result.employerPf.paise).toBe(1_80_000);
    expect(result.employerEdli.paise).toBe(7_500);
    expect(result.totalEmployerContributions.paise).toBe(1_87_500);

    expect(result.grossEarnings.subtract(result.totalDeductions).paise).toBe(result.netPay.paise);

    // Administration charges are a per-establishment minimum, so a single
    // employee's annexure must not carry the ₹500 floor.
    expect(result.pfDetail.adminCharges.paise).toBe(0);
  });

  /**
   * A month lost entirely still owes the year's tax instalment, so the slip can
   * end in a recovery. Flooring that at zero would hide it.
   */
  it('shows a recovery when a whole month is lost to leave', () => {
    const result = slip({
      monthlyGross: 200_000,
      monthlyBasic: 80_000,
      daysPayable: 31,
      lopDays: 31,
    });

    expect(result.paidDays).toBe(0);
    expect(result.grossEarnings.paise).toBe(0);
    expect(result.tds.paise).toBe(24_37_500);
    expect(result.netPay.paise).toBe(-24_37_500);
    expect(result.netPayInWords.startsWith('Minus Rupees ')).toBe(true);
    expect(result.notes.join(' ')).toContain('recoverable rather than payable');
  });
});

describe('the amount in words, in Indian numbering', () => {
  const cases: Array<[string, number, string]> = [
    ['nothing at all', 0, 'Rupees Zero Only'],
    ['the example on the tin', 42_350_00, 'Rupees Forty Two Thousand Three Hundred and Fifty Only'],
    ['a round hundred', 1_00_00, 'Rupees One Hundred Only'],
    [
      'just under a lakh',
      99_999_00,
      'Rupees Ninety Nine Thousand Nine Hundred and Ninety Nine Only',
    ],
    ['exactly a lakh', 1_00_000_00, 'Rupees One Lakh Only'],
    ['a rupee over a lakh', 1_00_001_00, 'Rupees One Lakh and One Only'],
    [
      'past the lakh, with a tail',
      1_23_456_00,
      'Rupees One Lakh Twenty Three Thousand Four Hundred and Fifty Six Only',
    ],
    ['a crore', 1_00_00_000_00, 'Rupees One Crore Only'],
    ['crores and lakhs', 2_50_00_000_00, 'Rupees Two Crore Fifty Lakh Only'],
    // Above a hundred crore the grouping keeps counting in crores - there is no
    // larger unit in the Indian system to reach for.
    ['above a hundred crore', 1_01_00_00_000_00, 'Rupees One Hundred and One Crore Only'],
    [
      'with paise',
      42_350_75,
      'Rupees Forty Two Thousand Three Hundred and Fifty and Seventy Five Paise Only',
    ],
    ['paise alone', 50, 'Rupees Zero and Fifty Paise Only'],
    [
      'a recovery',
      -1_234_56,
      'Minus Rupees One Thousand Two Hundred and Thirty Four and Fifty Six Paise Only',
    ],
  ];

  for (const [name, paise, expected] of cases) {
    it(`writes ${name}`, () => {
      expect(PayslipResult.amountInWords(Money.fromPaise(paise))).toBe(expected);
    });
  }

  it('carries its own net in words, zero paise and all', () => {
    const whole = slip();
    expect(whole.netPay.paise % 100).toBe(0);
    expect(whole.netPayInWords).toBe('Rupees Seventy Three Thousand Only');

    const fractional = slip({ payMonth: '2026-02-01', daysPayable: 28, lopDays: 2 });
    expect(fractional.netPayInWords).toBe(
      'Rupees Sixty Seven Thousand Six Hundred and Forty Two and Eighty Six Paise Only',
    );
  });
});

describe('what the slip hands on', () => {
  it('defaults the rate version to the wage month', () => {
    const implicit = calculatePayslip({
      employeeName: 'Asha Menon',
      monthlyGross: 75_000,
      monthlyBasic: 30_000,
      payMonth: '2025-08-01',
    });

    expect(implicit.netPay.paise).toBe(slip().netPay.paise);
  });

  it('accepts a Date wherever a string wage month goes', () => {
    const fromString = slip({ payMonth: '2025-09-15' });
    const fromDate = calculatePayslip({
      employeeName: 'Asha Menon',
      monthlyGross: 75_000,
      monthlyBasic: 30_000,
      payMonth: new Date(Date.UTC(2025, 8, 15)),
      asOf: AS_OF,
    });

    expect(fromString.daysInMonth).toBe(30);
    expect(fromString.netPay.paise).toBe(fromDate.netPay.paise);
  });

  it('cites the enactment behind every statutory deduction', () => {
    const result = slip({ monthlyGross: 18_000, monthlyBasic: 9_000 });

    expect(result.citations[0]).toBe(
      'Payment of Wages Act 1936, section 13A read with the Code on Wages 2019 - ' +
        'the particulars a wage slip must carry',
    );

    const citations = result.citations.join(' ');

    expect(citations).toContain("Employees' Provident Funds");
    expect(citations).toContain("Employees' State Insurance Act");
    expect(citations).toContain('Article 276');
    expect(citations).toContain('Income-tax Act');
  });

  it('is shaped for a payslip table on the wire', () => {
    const data = slip({ designation: 'Senior Engineer' }).toArray() as Record<string, never>;

    expect(data.employee_name).toBe('Asha Menon');
    expect(data.designation).toBe('Senior Engineer');
    expect(data.pay_month).toBe('2025-08');
    expect(data.pay_month_label).toBe('August 2025');
    expect(data.days_in_month).toBe(31);
    expect(data.paid_days).toBe(31);

    const labels = (rows: unknown): string[] =>
      (rows as Array<{ label: string }>).map((entry) => entry.label);

    expect(labels(data.earnings)).toEqual(['Basic', 'House rent allowance', 'Special allowance']);
    expect(labels(data.deductions)).toEqual([
      'Provident fund (employee share)',
      'Professional tax (Karnataka)',
    ]);
    expect(labels(data.employer_contributions)).toEqual([
      'Provident fund - EPF (A/c 1)',
      'Provident fund - EPS (A/c 10)',
      'EDLI (A/c 21)',
    ]);

    expect(data.net_pay).toBe(73000);
    expect(data.net_pay_formatted).toBe('₹73,000.00');
    expect(data.net_pay_in_words).toBe('Rupees Seventy Three Thousand Only');

    // Every scalar figure needs its formatted twin: the generic renderer pairs
    // `x` with `x_formatted` and prints the raw number otherwise.
    for (const key of [
      'gross_earnings',
      'total_deductions',
      'net_pay',
      'basic',
      'hra',
      'special_allowance',
    ]) {
      expect(data).toHaveProperty(`${key}_formatted`);
    }
  });

  it('is reachable under the name the single-tool package re-exports', () => {
    expect(payslipAlias).toBe(calculatePayslip);
  });
});

describe('caller errors', () => {
  const rejected: Array<[string, Partial<PayslipInput>]> = [
    ['no employee name', { employeeName: '   ' }],
    ['negative gross', { monthlyGross: -1 }],
    ['negative basic', { monthlyBasic: -1 }],
    ['basic above gross', { monthlyBasic: 80_000 }],
    ['negative days payable', { daysPayable: -1 }],
    ['negative loss of pay', { lopDays: -1 }],
    ['more loss of pay than days payable', { daysPayable: 10, lopDays: 11 }],
    ['an unparsable wage month', { payMonth: 'the middle of last year' }],
  ];

  for (const [name, overrides] of rejected) {
    it(`refuses rather than guesses: ${name}`, () => {
      expect(() => slip(overrides)).toThrow(InvalidInputError);
    });
  }
});
