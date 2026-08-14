import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/errors.js';
import { Money } from '../src/money.js';
import { RATES_CHECKSUM, RATE_TABLE_KEYS, RateRepository, defaultRates } from '../src/rates/index.js';
import { calculatePf } from '../src/calculators/pf.js';
import { calculateEsi } from '../src/calculators/esi.js';
import { calculateGratuity } from '../src/calculators/gratuity.js';
import { calculateBonus } from '../src/calculators/bonus.js';
import { calculateLeaveEncashment } from '../src/calculators/leave-encashment.js';
import { calculateTds } from '../src/calculators/tds.js';
import { calculateCtc } from '../src/calculators/ctc.js';
import { calculateFnf } from '../src/calculators/fnf.js';
import { calculateEpfoPenalty } from '../src/calculators/epfo-penalty.js';
import { complianceCalendar } from '../src/calculators/compliance-calendar.js';
import { calculateRoi } from '../src/calculators/roi.js';
import { calculateSavings } from '../src/calculators/savings.js';

const ASOF = '2025-06-01';

describe('rate tables', () => {
  it('ships every table the PHP package does', () => {
    expect([...RATE_TABLE_KEYS]).toEqual([
      'bonus',
      'compliance-calendar',
      'epf',
      'epfo-penalty',
      'esi',
      'gratuity',
      'gst',
      'income-tax',
      'leave-encashment',
      'professional-tax',
    ]);
  });

  it('carries a checksum so drift from the JSON is detectable', () => {
    expect(RATES_CHECKSUM).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores money in paise and only hands it back through money()', () => {
    const epf = defaultRates.for('epf', ASOF);

    expect(epf.get('wage_ceiling')).toBe(1_500_000);
    expect(epf.money('wage_ceiling').toRupees()).toBe(15000);
  });

  it('resolves a financial-year label as well as a date', () => {
    expect(defaultRates.for('income-tax', '2024-25').effectiveFrom.toISOString()).toContain('2024-04-01');
  });

  it('refuses to guess at a period it has no version for', () => {
    expect(() => new RateRepository().for('income-tax', '1998-04-01')).toThrow(/no version in force/);
  });
});

describe('EPF', () => {
  it('caps EPS at ₹1,250 while the employer still parts with the full 12%', () => {
    const result = calculatePf({ basicSalary: 30000, employerRestrictsToCeiling: false, asOf: ASOF });

    expect(result.employerTotal.toRupees()).toBe(3600);
    expect(result.employerEps.toRupees()).toBe(1250);
    // Not 8.33% of ₹30,000, which would be ₹2,499. Everything EPS cannot take
    // lands in EPF instead.
    expect(result.employerEpf.toRupees()).toBe(2350);
    expect(result.epsCapApplied).toBe(true);
  });

  it('sends the whole employer share to EPF for a non-member', () => {
    const result = calculatePf({ basicSalary: 25000, epsEligible: false, asOf: ASOF });

    expect(result.employerEps.isZero()).toBe(true);
    expect(result.employerEpf).toEqual(result.employerTotal);
  });

  it('stops EPS at 58', () => {
    expect(calculatePf({ basicSalary: 20000, age: 58, asOf: ASOF }).epsApplicable).toBe(false);
    expect(calculatePf({ basicSalary: 20000, age: 57, asOf: ASOF }).epsApplicable).toBe(true);
  });

  it('applies the ₹6,500 ceiling that stood before September 2014', () => {
    const historic = calculatePf({ basicSalary: 30000, asOf: '2013-06-01' });

    expect(historic.wageCeiling.toRupees()).toBe(6500);
    expect(historic.employeeContribution.toRupees()).toBe(780);
    expect(historic.employerEps.toRupees()).toBe(541);
  });

  it('rejects a negative salary but not an unusual one', () => {
    expect(() => calculatePf({ basicSalary: -1, asOf: ASOF })).toThrow(InvalidInputError);
    expect(() => calculatePf({ basicSalary: 0, asOf: ASOF })).not.toThrow();
    expect(() => calculatePf({ basicSalary: 15000, age: 12, asOf: ASOF })).toThrow(InvalidInputError);
  });
});

describe('ESI', () => {
  it('rounds each share up to the next rupee separately', () => {
    const result = calculateEsi({ grossWages: 17777, asOf: ASOF });

    // 0.75% is ₹133.33 and 3.25% is ₹577.75; rounding the combined 4% instead
    // would lose a rupee against the challan.
    expect(result.employeeContribution.toRupees()).toBe(134);
    expect(result.employerContribution.toRupees()).toBe(578);
    expect(result.totalContribution.toRupees()).toBe(712);
  });

  it('covers at the limit and drops out one rupee above it', () => {
    expect(calculateEsi({ grossWages: 21000, asOf: ASOF }).applicable).toBe(true);
    expect(calculateEsi({ grossWages: 21001, asOf: ASOF }).applicable).toBe(false);
  });

  it('keeps a mid-period riser covered to the end of the period', () => {
    const result = calculateEsi({ grossWages: 26000, continuingFromPriorPeriod: true, asOf: '2025-11-15' });

    expect(result.applicable).toBe(true);
    expect(result.coveredByContinuationRule).toBe(true);
    expect(result.contributionPeriod.to).toBe('2026-03-31');
  });

  it('relieves the employee, not the employer, under rule 52', () => {
    const result = calculateEsi({ grossWages: 5000, averageDailyWage: 170, asOf: ASOF });

    expect(result.employeeContribution.isZero()).toBe(true);
    expect(result.employerContribution.isPositive()).toBe(true);
  });

  it('applies the 1.75% / 4.75% rates that stood before July 2019', () => {
    const historic = calculateEsi({ grossWages: 18000, asOf: '2018-06-01' });

    expect(historic.employeeRate).toBe(1.75);
    expect(historic.employerRate).toBe(4.75);
    expect(historic.employeeContribution.toRupees()).toBe(315);
  });
});

describe('gratuity', () => {
  it('applies the six-month rule only above six months', () => {
    const six = calculateGratuity({ lastDrawnSalary: 45000, yearsOfService: 7, monthsOfService: 6, asOf: ASOF });
    const seven = calculateGratuity({ lastDrawnSalary: 45000, yearsOfService: 7, monthsOfService: 7, asOf: ASOF });

    expect(six.completedYears).toBe(7);
    expect(seven.completedYears).toBe(8);
    expect(seven.gratuity.toRupees()).toBe(207692.31);
  });

  it('is not an error to be ineligible', () => {
    const result = calculateGratuity({ lastDrawnSalary: 45000, yearsOfService: 4, monthsOfService: 11, asOf: ASOF });

    expect(result.eligible).toBe(false);
    expect(result.gratuity.isZero()).toBe(true);
    expect(result.ineligibilityReason).toContain('5 years of continuous service');
  });

  it('waives the qualifying period on death', () => {
    const result = calculateGratuity({
      lastDrawnSalary: 45000,
      yearsOfService: 3,
      separationReason: 'death',
      asOf: ASOF,
    });

    expect(result.eligible).toBe(true);
    expect(result.gratuity.isPositive()).toBe(true);
  });

  it('divides by 30 and skips the rounding outside the Act', () => {
    const result = calculateGratuity({
      lastDrawnSalary: 45000,
      yearsOfService: 7,
      monthsOfService: 8,
      covered: false,
      asOf: ASOF,
    });

    expect(result.divisor).toBe(30);
    expect(result.completedYears).toBe(7);
  });

  it('splits the section 10(10) exemption at the ceiling of the day', () => {
    const current = calculateGratuity({ lastDrawnSalary: 300000, yearsOfService: 25, asOf: ASOF });
    const historic = calculateGratuity({ lastDrawnSalary: 300000, yearsOfService: 25, asOf: '2015-06-01' });

    expect(current.taxExempt.toRupees()).toBe(2000000);
    expect(historic.taxExempt.toRupees()).toBe(1000000);
    expect(historic.taxable.greaterThan(current.taxable)).toBe(true);
  });

  it('rejects an unknown separation reason', () => {
    expect(() =>
      calculateGratuity({ lastDrawnSalary: 45000, yearsOfService: 8, separationReason: 'resigned', asOf: ASOF }),
    ).toThrow(InvalidInputError);
  });
});

describe('bonus', () => {
  it('separates the eligibility limit from the calculation ceiling', () => {
    const result = calculateBonus({ monthlyWages: 18000, daysWorked: 240, asOf: ASOF });

    expect(result.eligible).toBe(true);
    expect(result.ceilingWage.toRupees()).toBe(7000);
    expect(result.ceilingApplied()).toBe(true);
  });

  it('pays nothing above ₹21,000', () => {
    expect(calculateBonus({ monthlyWages: 21001, daysWorked: 240, asOf: ASOF }).eligible).toBe(false);
    expect(calculateBonus({ monthlyWages: 21000, daysWorked: 240, asOf: ASOF }).eligible).toBe(true);
  });

  it('requires thirty working days', () => {
    expect(calculateBonus({ monthlyWages: 12000, daysWorked: 29, asOf: ASOF }).eligible).toBe(false);
  });

  it('lets a notified minimum wage raise the ceiling', () => {
    const result = calculateBonus({ monthlyWages: 18000, minimumWage: 9500, daysWorked: 240, asOf: ASOF });

    expect(result.calculationCeiling.toRupees()).toBe(9500);
  });

  it('refuses a rate outside 8.33% to 20%', () => {
    expect(() => calculateBonus({ monthlyWages: 12000, bonusRate: 25, asOf: ASOF })).toThrow(InvalidInputError);
    expect(() => calculateBonus({ monthlyWages: 12000, bonusRate: 5, asOf: ASOF })).toThrow(InvalidInputError);
  });

  it('uses the ₹3,500 ceiling in force before 2014', () => {
    expect(calculateBonus({ monthlyWages: 9000, daysWorked: 240, asOf: '2010-06-01' }).ceilingWage.toRupees()).toBe(
      3500,
    );
  });
});

describe('leave encashment', () => {
  it('takes the least of the four limbs', () => {
    const result = calculateLeaveEncashment({
      averageMonthlySalary: 60000,
      leaveDaysEncashed: 200,
      yearsOfService: 5,
      asOf: ASOF,
    });

    // 30 days a year for 5 years is 150 days of credit, so limb (d) binds.
    expect(result.eligibleLeaveDays).toBe(150);
    expect(result.bindingLimb).toBe('leave_credit');
  });

  it('exempts a government employee entirely', () => {
    const result = calculateLeaveEncashment({
      averageMonthlySalary: 90000,
      leaveDaysEncashed: 300,
      yearsOfService: 30,
      governmentEmployee: true,
      asOf: ASOF,
    });

    expect(result.taxable.isZero()).toBe(true);
    expect(result.exemption).toEqual(result.encashment);
  });

  it('taxes encashment drawn while still employed in full', () => {
    const result = calculateLeaveEncashment({
      averageMonthlySalary: 60000,
      leaveDaysEncashed: 15,
      yearsOfService: 6,
      duringService: true,
      asOf: ASOF,
    });

    expect(result.exemption.isZero()).toBe(true);
    expect(result.taxable).toEqual(result.encashment);
  });

  it('uses the ₹3,00,000 ceiling that stood before AY 2024-25', () => {
    const historic = calculateLeaveEncashment({
      averageMonthlySalary: 90000,
      leaveDaysEncashed: 300,
      yearsOfService: 30,
      asOf: '2020-06-01',
    });

    expect(historic.exemptionLimit.toRupees()).toBe(300000);
    expect(historic.exemption.toRupees()).toBe(300000);
  });
});

describe('TDS and income tax', () => {
  it('leaves ₹12,00,000 of taxable income free under the 87A rebate', () => {
    const result = calculateTds({ monthlyGross: 106250, asOf: ASOF });

    // ₹12,75,000 gross less the ₹75,000 standard deduction is exactly ₹12,00,000.
    expect(result.tax.taxableIncome.toRupees()).toBe(1200000);
    expect(result.annualTax.isZero()).toBe(true);
  });

  it('applies marginal relief just above the rebate threshold', () => {
    const result = calculateTds({ monthlyGross: 106250 + 1000, asOf: ASOF });

    // The slabs alone would charge far more than the ₹12,000 of extra income.
    expect(result.tax.marginalRelief.isPositive()).toBe(true);
    expect(result.tax.taxAfterRebate.toRupees()).toBeLessThanOrEqual(12000);
  });

  it('spreads the balance over the months that remain', () => {
    const result = calculateTds({
      monthlyGross: 150000,
      monthsRemaining: 5,
      taxAlreadyDeducted: 40000,
      asOf: ASOF,
    });

    expect(result.monthsRemaining).toBe(5);
    expect(result.monthlyTds.multiply(5).toRupees()).toBeCloseTo(result.balanceTax.toRupees(), 0);
  });

  it('reports, rather than silently drops, a deduction the new regime refuses', () => {
    const result = calculateTds({ monthlyGross: 100000, deductions: { '80c': 150000 }, asOf: ASOF });

    expect(result.tax.ignoredDeductions).toHaveLength(1);
    expect(result.tax.ignoredDeductions[0].section).toBe('80c');
    expect(result.tax.chapterViaDeductions.isZero()).toBe(true);
  });

  it('raises the exemption limit for a senior citizen in the old regime', () => {
    const senior = calculateTds({ monthlyGross: 60000, regime: 'old', age: 65, asOf: ASOF });
    const junior = calculateTds({ monthlyGross: 60000, regime: 'old', age: 45, asOf: ASOF });

    expect(senior.annualTax.lessThan(junior.annualTax)).toBe(true);
  });

  it('resolves FY 2024-25 slabs for a 2024 date', () => {
    expect(calculateTds({ monthlyGross: 100000, asOf: '2024-06-01' }).tax.financialYear).toBe('2024-25');
    expect(calculateTds({ monthlyGross: 100000, asOf: ASOF }).tax.financialYear).toBe('2025-26');
  });

  it('rounds the final liability to the nearest ten rupees', () => {
    const result = calculateTds({ monthlyGross: 200000, asOf: ASOF });
    expect(result.annualTax.paise % 1000).toBe(0);
  });
});

describe('CTC', () => {
  it('reconciles the components back to the CTC exactly', () => {
    const result = calculateCtc({ annualCtc: 1200000, asOf: ASOF });

    expect(result.reconciledMonthlyCtc().paise).toBe(result.monthlyCtc.paise);
  });

  it('carries ESI where the gross falls inside the wage limit', () => {
    expect(calculateCtc({ annualCtc: 240000, asOf: ASOF }).esi.applicable).toBe(true);
    expect(calculateCtc({ annualCtc: 1200000, asOf: ASOF }).esi.applicable).toBe(false);
  });

  it('refuses inputs it cannot build a structure from', () => {
    expect(() => calculateCtc({ annualCtc: -1, asOf: ASOF })).toThrow(InvalidInputError);
    expect(() => calculateCtc({ annualCtc: 1200000, basicPercent: 0, asOf: ASOF })).toThrow(InvalidInputError);
    expect(() => calculateCtc({ annualCtc: 1200000, regime: 'newer', asOf: ASOF })).toThrow(InvalidInputError);
  });

  it('refuses a basic and HRA split that leaves no allowance', () => {
    expect(() => calculateCtc({ annualCtc: 1200000, basicPercent: 90, hraPercent: 100, asOf: ASOF })).toThrow(
      InvalidInputError,
    );
  });
});

describe('full and final settlement', () => {
  it('counts the last working day, so five years to the day qualifies', () => {
    const result = calculateFnf({
      monthlyGross: 60000,
      monthlyBasic: 30000,
      joiningDate: '2020-01-01',
      lastWorkingDate: '2024-12-31',
      leaveDaysBalance: 30,
    });

    expect(result.serviceYears).toBe(5);
    expect(result.gratuityEligible).toBe(true);
  });

  it('recovers notice pay short of the period, but never on death', () => {
    const resignation = calculateFnf({
      monthlyGross: 80000,
      monthlyBasic: 40000,
      joiningDate: '2022-01-10',
      lastWorkingDate: '2025-02-28',
      noticePeriodDays: 90,
      noticeDaysServed: 15,
    });

    const death = calculateFnf({
      monthlyGross: 70000,
      monthlyBasic: 35000,
      joiningDate: '2023-04-01',
      lastWorkingDate: '2025-07-15',
      noticePeriodDays: 60,
      noticeDaysServed: 0,
      separationReason: 'death',
    });

    expect(resignation.noticeShortfallDays).toBe(75);
    expect(resignation.noticePayRecovery.isPositive()).toBe(true);
    expect(death.noticePayRecovery.isZero()).toBe(true);
  });

  it('can leave the employee owing the company', () => {
    const result = calculateFnf({
      monthlyGross: 80000,
      monthlyBasic: 40000,
      joiningDate: '2024-06-01',
      lastWorkingDate: '2025-06-05',
      noticePeriodDays: 90,
      noticeDaysServed: 0,
    });

    expect(result.employeeOwesCompany).toBe(true);
    expect(result.netPayable.isNegative()).toBe(true);
  });

  it('keeps the exempt gratuity and leave out of the TDS base', () => {
    const result = calculateFnf({
      monthlyGross: 80000,
      monthlyBasic: 40000,
      joiningDate: '2018-06-01',
      lastWorkingDate: '2025-08-20',
      leaveDaysBalance: 24,
    });

    expect(result.gratuityTaxable.isZero()).toBe(true);
    expect(result.exemptEarnings.isPositive()).toBe(true);
    expect(result.taxableEarnings.lessThan(result.grossEarnings)).toBe(true);
  });
});

describe('EPFO penalties', () => {
  it('charges nothing when the challan is paid by the 15th', () => {
    const result = calculateEpfoPenalty({
      contributionAmount: 250000,
      wageMonth: '2025-04-01',
      actualPaymentDate: '2025-05-15',
    });

    expect(result.isLate).toBe(false);
    expect(result.total).toEqual(result.contributionAmount);
  });

  it('reads a fraction of a month as a whole one on the flat basis', () => {
    const result = calculateEpfoPenalty({
      contributionAmount: 250000,
      wageMonth: '2025-04-01',
      actualPaymentDate: '2025-05-16',
    });

    expect(result.delayDays).toBe(1);
    expect(result.delayMonths).toBe(1);
    expect(result.damagesBasis).toBe('flat_per_month');
    expect(result.damages.toRupees()).toBe(2500);
  });

  it('uses the old slab scale for a default that began before June 2024', () => {
    const result = calculateEpfoPenalty({
      contributionAmount: 250000,
      wageMonth: '2023-05-01',
      actualPaymentDate: '2023-09-20',
    });

    expect(result.damagesBasis).toBe('slab_per_annum');
    expect(result.damagesRate).toBe(10);
    expect(result.rateVersion).toBe('2008-09-26');
  });

  it("caps damages at the arrears, as section 14B's proviso requires", () => {
    const result = calculateEpfoPenalty({
      contributionAmount: 100000,
      wageMonth: '2024-07-01',
      actualPaymentDate: '2035-01-05',
    });

    expect(result.damagesCappedAtArrears).toBe(true);
    expect(result.damages).toEqual(result.contributionAmount);
  });
});

describe('compliance calendar', () => {
  it('expands the rules into a full year of dated obligations', () => {
    const result = complianceCalendar({ financialYear: '2025-26', asOf: '2025-04-01' });

    expect(result.events.length).toBeGreaterThan(50);
    expect(result.codes()).toContain('PF_ECR');
    expect(result.periodStart.toISOString()).toContain('2025-04-01');
    expect(result.periodEnd.toISOString()).toContain('2026-03-31');
  });

  it("puts March's TDS on 30 April rather than 7 April", () => {
    const result = complianceCalendar({ financialYear: '2025-26', only: ['TDS_PAY'], asOf: '2025-04-01' });
    const march = result.events.find((event) => event.context.period_month === '2026-03');

    expect(march?.date.toISOString()).toContain('2026-04-30');
  });

  it('swaps GST to the quarterly variants under QRMP', () => {
    const monthly = complianceCalendar({ financialYear: '2025-26', only: ['GSTR_3B'], asOf: '2025-04-01' });
    const quarterly = complianceCalendar({
      financialYear: '2025-26',
      only: ['GSTR_3B'],
      qrmp: true,
      asOf: '2025-04-01',
    });

    expect(monthly.events).toHaveLength(12);
    expect(quarterly.events).toHaveLength(4);
  });

  it('gives every event a stable identifier', () => {
    const first = complianceCalendar({ financialYear: '2025-26', asOf: '2025-04-01' }).events[0];
    const second = complianceCalendar({ financialYear: '2025-26', asOf: '2025-06-09' }).events[0];

    expect(first.uid()).toBe(second.uid());
  });

  it('reports obligations it cannot schedule rather than dropping them', () => {
    const result = complianceCalendar({ financialYear: '2025-26', asOf: '2025-04-01' });

    expect(result.unscheduled.map((entry) => entry.code)).toContain('LWF');
  });
});

describe('business cases', () => {
  it('reports an undefined ROI rather than infinity', () => {
    const result = calculateRoi({ employeeCount: 40, hourlyRate: 650, hoursPerCycleManual: 10 });

    expect(result.roiPercent).toBeNull();
    expect(result.paybackMonths).toBe(0);
  });

  it('never claims a payback that will not happen', () => {
    const result = calculateRoi({
      employeeCount: 10,
      hourlyRate: 500,
      hoursPerCycleManual: 0,
      automationEfficiency: 0,
      softwareAnnualCost: 100000,
    });

    expect(result.paybackMonths).toBeNull();
    expect(result.isWorthwhile()).toBe(false);
  });

  it('says so when the proposal costs more', () => {
    const result = calculateSavings({
      employeeCount: 15,
      currentPerEmployeePerMonth: 50,
      proposedPerEmployeePerMonth: 90,
      proposedAnnualPlatformFee: 12000,
      contractMonths: 36,
    });

    expect(result.proposalCostsMore).toBe(true);
    expect(result.annualSaving.isNegative()).toBe(true);
    expect(result.breakEvenMonths).toBeNull();
  });

  it('shows how the saving scales with headcount', () => {
    const result = calculateSavings({
      employeeCount: 120,
      currentPerEmployeePerMonth: 120,
      proposedPerEmployeePerMonth: 70,
      currentAnnualPlatformFee: 60000,
    });

    expect(result.sensitivity.map((entry) => entry.employee_count)).toEqual([60, 120, 240, 600]);
  });
});

describe('the shared result shape', () => {
  it('exposes amount, workings and citations on every calculator', () => {
    const results = [
      calculatePf({ basicSalary: 15000, asOf: ASOF }),
      calculateEsi({ grossWages: 18000, asOf: ASOF }),
      calculateGratuity({ lastDrawnSalary: 45000, yearsOfService: 8, asOf: ASOF }),
      calculateBonus({ monthlyWages: 12000, daysWorked: 240, asOf: ASOF }),
      calculateLeaveEncashment({ averageMonthlySalary: 60000, leaveDaysEncashed: 30, yearsOfService: 5, asOf: ASOF }),
      calculateTds({ monthlyGross: 100000, asOf: ASOF }),
      calculateCtc({ annualCtc: 1200000, asOf: ASOF }),
      calculateEpfoPenalty({
        contributionAmount: 250000,
        wageMonth: '2025-04-01',
        actualPaymentDate: '2025-06-30',
      }),
      complianceCalendar({ financialYear: '2025-26', asOf: '2025-04-01' }),
      calculateRoi({ employeeCount: 10, hourlyRate: 500, hoursPerCycleManual: 8 }),
      calculateSavings({ employeeCount: 10, currentPerEmployeePerMonth: 100, proposedPerEmployeePerMonth: 60 }),
    ];

    for (const result of results) {
      expect(result.amount).toBeInstanceOf(Money);
      expect(Array.isArray([...result.workings])).toBe(true);
      expect(result.workings.length).toBeGreaterThan(0);
      expect(typeof result.explain()).toBe('string');
      expect(JSON.stringify(result)).toContain('"citations"');
    }
  });

  it('gives every statutory step a citation', () => {
    const steps = calculateGratuity({ lastDrawnSalary: 45000, yearsOfService: 8, asOf: ASOF }).workings;

    expect(steps.every((step) => step.citation !== null)).toBe(true);
  });
});
