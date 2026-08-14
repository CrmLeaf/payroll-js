/**
 * The form definitions the embeddable widgets are built from.
 *
 * A tool is a list of fields plus a `run` that turns the collected values into a
 * headline figure, a table of rows and the working behind them. Keeping that
 * description as data rather than as markup is what lets one custom element
 * render all twelve calculators, and lets a host page reuse the same definitions
 * to build its own UI without touching the renderer.
 */

import { financialYearOf, financialYearStart, today } from '../dates.js';
import { Money } from '../money.js';
import { defaultRates } from '../rates/index.js';
import type { Step } from '../result.js';
import { calculateBonus } from '../calculators/bonus.js';
import { complianceCalendar, type ComplianceEvent } from '../calculators/compliance-calendar.js';
import { calculateCtc } from '../calculators/ctc.js';
import { calculateEpfoPenalty } from '../calculators/epfo-penalty.js';
import { calculateEsi } from '../calculators/esi.js';
import { calculateFnf } from '../calculators/fnf.js';
import { calculateGratuity } from '../calculators/gratuity.js';
import { calculateInvoice } from '../calculators/invoice.js';
import { calculateLeaveEncashment } from '../calculators/leave-encashment.js';
import { calculatePayslip } from '../calculators/payslip.js';
import { calculatePf } from '../calculators/pf.js';
import { calculateRoi } from '../calculators/roi.js';
import { calculateSalaryTemplate, SalaryTemplateBuilder } from '../calculators/salary-templates.js';
import { calculateSavings } from '../calculators/savings.js';
import { calculateTds } from '../calculators/tds.js';
import { statesWithProfessionalTax } from '../calculators/professional-tax.js';

export type FieldValue = string | number | boolean;
export type FieldValues = Record<string, FieldValue>;

export interface ToolField {
  name: string;
  label: string;
  type: 'money' | 'number' | 'text' | 'select' | 'checkbox' | 'date';
  default?: FieldValue;
  options?: Array<{ value: string; label: string }>;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface ToolRow {
  label: string;
  value: string;
  emphasis?: boolean;
  muted?: boolean;
}

export interface ToolOutput {
  headline: { label: string; value: string };
  rows: ToolRow[];
  note?: string;
  events?: ComplianceEvent[];
  explanation: string;
  workings: readonly Step[];
  citations: readonly string[];
}

export interface ToolDefinition {
  /** The tools.json slug, and the `data-payroll` attribute value. */
  slug: string;
  /** The custom element tag name. */
  element: string;
  name: string;
  tagline: string;
  fields: ToolField[];
  run(values: FieldValues): ToolOutput;
}

const num = (values: FieldValues, name: string, fallback = 0): number => {
  const raw = values[name];
  if (raw === undefined || raw === '' || raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const text = (values: FieldValues, name: string, fallback = ''): string => {
  const raw = values[name];
  return raw === undefined || raw === null || raw === '' ? fallback : String(raw);
};

const flag = (values: FieldValues, name: string, fallback = false): boolean => {
  const raw = values[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw === true || raw === 'true' || raw === 'on' || raw === '1';
};

const row = (label: string, amount: Money, emphasis = false): ToolRow => ({
  label,
  value: amount.format(),
  emphasis,
});

const REGIME_OPTIONS = [
  { value: 'new', label: 'New regime (default)' },
  { value: 'old', label: 'Old regime' },
];

const SEPARATION_OPTIONS = [
  { value: 'resignation', label: 'Resignation' },
  { value: 'retirement', label: 'Retirement' },
  { value: 'superannuation', label: 'Superannuation' },
  { value: 'termination', label: 'Termination' },
  { value: 'retrenchment', label: 'Retrenchment' },
  { value: 'death', label: 'Death' },
  { value: 'disablement', label: 'Disablement' },
];

function stateOptions(): Array<{ value: string; label: string }> {
  return statesWithProfessionalTax().map((state) => ({ value: state, label: state }));
}

/**
 * The GST state codes, which are a different list from the professional tax one -
 * every state and union territory has a GST code, but only some levy a
 * professional tax. The label carries the code because the place of supply is
 * read off a GSTIN as often as it is typed out.
 */
function gstStateOptions(): Array<{ value: string; label: string }> {
  const codes = defaultRates.for('gst').record<string>('state_codes');

  return Object.entries(codes).map(([code, name]) => ({ value: name, label: `${name} (${code})` }));
}

const GST_SLAB_OPTIONS = defaultRates
  .for('gst')
  .array<number>('slabs')
  .map((slab) => ({ value: String(slab), label: `${slab}%` }));

const TEMPLATE_OPTIONS = SalaryTemplateBuilder.templates().map((template) => ({
  value: template,
  label: `${template.charAt(0).toUpperCase()}${template.slice(1)}`,
}));

/**
 * The financial years the slab table actually carries, newest first.
 *
 * Income tax is the one table with a closed end date - a Finance Act covers one
 * year and no more - so a widget that quietly defaulted to "today" would start
 * refusing to compute the morning after 31 March. Making the year an explicit
 * control instead is both honest and more useful: a payroll team spends half of
 * April working on the year that has just closed.
 */
const TAX_YEARS: string[] = defaultRates
  .versions('income-tax')
  .map((table) => financialYearOf(table.effectiveFrom));

const CURRENT_TAX_YEAR: string = TAX_YEARS.includes(financialYearOf(today()))
  ? financialYearOf(today())
  : TAX_YEARS[0];

const taxYearField = (): ToolField => ({
  name: 'financialYear',
  label: 'Financial year',
  type: 'select',
  default: CURRENT_TAX_YEAR,
  options: TAX_YEARS.map((year) => ({ value: year, label: `FY ${year}` })),
  hint: 'Slabs, the standard deduction and the 87A rebate are all year-specific.',
});

const taxYearAsOf = (values: FieldValues): Date =>
  financialYearStart(text(values, 'financialYear', CURRENT_TAX_YEAR));

export const TOOLS: ToolDefinition[] = [
  {
    slug: 'ctc-calculator',
    element: 'payroll-ctc-calculator',
    name: 'CTC Calculator',
    tagline: 'Break down CTC into basic, HRA, PF, ESI, gratuity and net in-hand.',
    fields: [
      { name: 'annualCtc', label: 'Annual CTC', type: 'money', default: 1200000 },
      { name: 'state', label: 'State', type: 'select', default: 'Karnataka', options: stateOptions() },
      { name: 'basicPercent', label: 'Basic as % of CTC', type: 'number', default: 40, min: 1, max: 100 },
      { name: 'hraPercent', label: 'HRA as % of basic', type: 'number', default: 50, min: 0, max: 100 },
      { name: 'regime', label: 'Tax regime', type: 'select', default: 'new', options: REGIME_OPTIONS },
      taxYearField(),
      { name: 'includeBonus', label: 'Provide for statutory bonus', type: 'checkbox', default: false },
    ],
    run(values) {
      const result = calculateCtc({
        annualCtc: num(values, 'annualCtc'),
        state: text(values, 'state', 'Karnataka'),
        basicPercent: num(values, 'basicPercent', 40),
        hraPercent: num(values, 'hraPercent', 50),
        regime: text(values, 'regime', 'new'),
        includeBonus: flag(values, 'includeBonus'),
        asOf: taxYearAsOf(values),
      });

      return {
        headline: { label: 'Net in hand, a month', value: result.netInHand.format() },
        rows: [
          row('Basic', result.basic),
          row('House rent allowance', result.hra),
          row('Special allowance', result.specialAllowance),
          row('Gross salary', result.grossSalary, true),
          row('Provident fund (employee)', result.employeePf),
          row('ESI (employee)', result.employeeEsi),
          row('Professional tax', result.professionalTax),
          row('TDS', result.tds),
          row('Total deductions', result.totalDeductions, true),
          row('Net in hand', result.netInHand, true),
        ],
        note: result.assumptions[0],
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'tds-calculator',
    element: 'payroll-tds-calculator',
    name: 'TDS Calculator',
    tagline: 'Monthly TDS under the new or old regime.',
    fields: [
      { name: 'monthlyGross', label: 'Monthly gross salary', type: 'money', default: 100000 },
      { name: 'regime', label: 'Tax regime', type: 'select', default: 'new', options: REGIME_OPTIONS },
      taxYearField(),
      { name: 'age', label: 'Age', type: 'number', default: 30, min: 0, max: 120 },
      {
        name: 'monthsRemaining',
        label: 'Months remaining in the year',
        type: 'number',
        default: 12,
        min: 1,
        max: 12,
      },
      {
        name: 'deduction80c',
        label: 'Section 80C investments (old regime only)',
        type: 'money',
        default: 0,
        hint: 'The new regime disallows this; the result will say so.',
      },
    ],
    run(values) {
      const claim = num(values, 'deduction80c');
      const result = calculateTds({
        monthlyGross: num(values, 'monthlyGross'),
        regime: text(values, 'regime', 'new'),
        age: num(values, 'age', 30),
        monthsRemaining: num(values, 'monthsRemaining', 12),
        deductions: claim > 0 ? { '80c': claim } : {},
        asOf: taxYearAsOf(values),
      });

      return {
        headline: { label: 'Monthly TDS', value: result.monthlyTds.format() },
        rows: [
          row('Annualised salary', result.annualGross),
          row('Taxable income', result.tax.taxableIncome),
          row('Tax at slab rates', result.tax.slabTax),
          row('Rebate under 87A', result.tax.rebate),
          row('Marginal relief', result.tax.marginalRelief),
          row('Health and education cess', result.tax.cess),
          row('Annual tax', result.annualTax, true),
          row('Monthly TDS', result.monthlyTds, true),
        ],
        note: [`FY ${result.tax.financialYear} slabs.`, result.tax.notes[0]].filter(Boolean).join(' '),
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'pf-calculator',
    element: 'payroll-pf-calculator',
    name: 'PF Calculator',
    tagline: 'EPF employee, employer and EPS shares with the wage ceiling applied.',
    fields: [
      { name: 'basicSalary', label: 'Basic salary + DA, a month', type: 'money', default: 30000 },
      {
        name: 'employerRestrictsToCeiling',
        label: 'Employer restricts PF to the ₹15,000 ceiling',
        type: 'checkbox',
        default: true,
      },
      { name: 'epsEligible', label: 'Member of the Pension Scheme', type: 'checkbox', default: true },
      {
        name: 'includeAdminCharges',
        label: 'Include administration charges',
        type: 'checkbox',
        default: false,
        hint: 'The ₹500 floor is a per-establishment minimum, not a per-employee one.',
      },
    ],
    run(values) {
      const result = calculatePf({
        basicSalary: num(values, 'basicSalary'),
        employerRestrictsToCeiling: flag(values, 'employerRestrictsToCeiling', true),
        epsEligible: flag(values, 'epsEligible', true),
        includeAdminCharges: flag(values, 'includeAdminCharges'),
      });

      return {
        headline: { label: 'Total monthly remittance', value: result.monthlyTotal.format() },
        rows: [
          row('PF wages', result.pfWages),
          row('Employee contribution', result.employeeContribution),
          row('Employer - EPF (A/c 1)', result.employerEpf),
          row('Employer - EPS (A/c 10)', result.employerEps),
          row('EDLI (A/c 21)', result.edli),
          row('Administration charges', result.adminCharges),
          row('Total cost to employer', result.totalCostToEmployer, true),
          row('Total remittance', result.monthlyTotal, true),
        ],
        note: result.epsCapApplied
          ? 'The EPS share is capped at 8.33% of the ₹15,000 ceiling. Everything the Pension Scheme cannot ' +
            'take lands in the provident fund instead, so the employer still parts with the full 12%.'
          : (result.epsNote ?? undefined),
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'esi-calculator',
    element: 'payroll-esi-calculator',
    name: 'ESI Calculator',
    tagline: 'ESI employee and employer contributions for any wage.',
    fields: [
      { name: 'grossWages', label: 'Gross wages, a month', type: 'money', default: 18000 },
      { name: 'disabled', label: 'Employee with a disability', type: 'checkbox', default: false },
      {
        name: 'continuingFromPriorPeriod',
        label: 'Already contributing this contribution period',
        type: 'checkbox',
        default: false,
        hint: 'Contributions that begin in a period run to the end of it, even above the wage limit.',
      },
    ],
    run(values) {
      const result = calculateEsi({
        grossWages: num(values, 'grossWages'),
        disabled: flag(values, 'disabled'),
        continuingFromPriorPeriod: flag(values, 'continuingFromPriorPeriod'),
      });

      return {
        headline: {
          label: result.applicable ? 'Total contribution' : 'Not covered',
          value: result.totalContribution.format(),
        },
        rows: [
          row('Gross wages', result.grossWages),
          row('Wage limit', result.wageLimit),
          row('Employee share', result.employeeContribution),
          row('Employer share', result.employerContribution),
          row('Total', result.totalContribution, true),
        ],
        note: result.reason,
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'gratuity-calculator',
    element: 'payroll-gratuity-calculator',
    name: 'Gratuity Calculator',
    tagline: 'Payment of Gratuity Act 1972 formula with the exemption cap applied.',
    fields: [
      { name: 'lastDrawnSalary', label: 'Last drawn basic + DA', type: 'money', default: 45000 },
      { name: 'yearsOfService', label: 'Completed years of service', type: 'number', default: 8, min: 0 },
      {
        name: 'monthsOfService',
        label: 'Additional months',
        type: 'number',
        default: 0,
        min: 0,
        max: 11,
        hint: 'More than six months rounds the year up.',
      },
      {
        name: 'separationReason',
        label: 'Reason for separation',
        type: 'select',
        default: 'resignation',
        options: SEPARATION_OPTIONS,
      },
      {
        name: 'covered',
        label: 'Establishment covered by the Act',
        type: 'checkbox',
        default: true,
        hint: 'Covered establishments divide by 26; others by 30.',
      },
    ],
    run(values) {
      const result = calculateGratuity({
        lastDrawnSalary: num(values, 'lastDrawnSalary'),
        yearsOfService: num(values, 'yearsOfService'),
        monthsOfService: num(values, 'monthsOfService'),
        separationReason: text(values, 'separationReason', 'resignation'),
        covered: flag(values, 'covered', true),
      });

      return {
        headline: {
          label: result.eligible ? 'Gratuity payable' : 'No gratuity payable',
          value: result.gratuity.format(),
        },
        rows: [
          row('Last drawn salary', result.lastDrawnSalary),
          { label: 'Completed years counted', value: String(result.completedYears) },
          row('Gratuity', result.gratuity, true),
          row('Exempt under section 10(10)', result.taxExempt),
          row('Taxable as salary', result.taxable),
        ],
        note: result.ineligibilityReason ?? undefined,
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'bonus-calculator',
    element: 'payroll-bonus-calculator',
    name: 'Bonus Calculator',
    tagline: 'Statutory bonus under the Payment of Bonus Act, 8.33% to 20%.',
    fields: [
      { name: 'monthlyWages', label: 'Monthly wages (basic + DA)', type: 'money', default: 18000 },
      { name: 'bonusRate', label: 'Bonus rate %', type: 'number', default: 8.33, min: 8.33, max: 20, step: 0.01 },
      { name: 'monthsWorked', label: 'Months worked', type: 'number', default: 12, min: 0, max: 12 },
      { name: 'daysWorked', label: 'Days worked in the year', type: 'number', default: 240, min: 0 },
      {
        name: 'minimumWage',
        label: 'Notified minimum wage, if higher than ₹7,000',
        type: 'money',
        default: 0,
      },
    ],
    run(values) {
      const minimumWage = num(values, 'minimumWage');
      const result = calculateBonus({
        monthlyWages: num(values, 'monthlyWages'),
        bonusRate: num(values, 'bonusRate', 8.33),
        monthsWorked: num(values, 'monthsWorked', 12),
        daysWorked: num(values, 'daysWorked', 30),
        minimumWage: minimumWage > 0 ? minimumWage : null,
      });

      return {
        headline: {
          label: result.eligible ? 'Bonus payable' : 'No bonus payable',
          value: result.bonus.format(),
        },
        rows: [
          row('Monthly wages', result.monthlyWages),
          row('Eligibility limit', result.eligibilityLimit),
          row('Wage the bonus is computed on', result.ceilingWage),
          row('Bonus a month', result.monthlyBonus),
          row('Bonus for the year', result.bonus, true),
        ],
        note:
          result.ineligibilityReason ??
          (result.ceilingApplied()
            ? 'Eligibility is tested on actual wages, but the bonus is computed on the ₹7,000 ceiling.'
            : undefined),
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'leave-encashment-calculator',
    element: 'payroll-leave-encashment-calculator',
    name: 'Leave Encashment Calculator',
    tagline: 'Encash unused earned leave at separation with the 10(10AA) exemption.',
    fields: [
      { name: 'averageMonthlySalary', label: 'Average monthly salary (basic + DA)', type: 'money', default: 60000 },
      { name: 'leaveDaysEncashed', label: 'Leave days encashed', type: 'number', default: 90, min: 0 },
      { name: 'yearsOfService', label: 'Completed years of service', type: 'number', default: 10, min: 0 },
      { name: 'governmentEmployee', label: 'Government employee', type: 'checkbox', default: false },
      { name: 'duringService', label: 'Encashed while still in service', type: 'checkbox', default: false },
    ],
    run(values) {
      const result = calculateLeaveEncashment({
        averageMonthlySalary: num(values, 'averageMonthlySalary'),
        leaveDaysEncashed: num(values, 'leaveDaysEncashed'),
        yearsOfService: num(values, 'yearsOfService'),
        governmentEmployee: flag(values, 'governmentEmployee'),
        duringService: flag(values, 'duringService'),
      });

      return {
        headline: { label: 'Encashment', value: result.encashment.format() },
        rows: [
          row('Per-day salary', result.perDaySalary),
          row('Limb (a) actual encashment', result.limbActual),
          row('Limb (b) statutory ceiling', result.limbStatutoryLimit),
          row('Limb (c) ten months of salary', result.limbMonthsOfSalary),
          row('Limb (d) leave credit at 30 days a year', result.limbLeaveCredit),
          row('Exempt', result.exemption, true),
          row('Taxable', result.taxable, true),
        ],
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'fnf-calculator',
    element: 'payroll-fnf-calculator',
    name: 'F&F Settlement Calculator',
    tagline: 'Full and final settlement: dues, gratuity, leave, notice pay and deductions.',
    fields: [
      { name: 'monthlyGross', label: 'Monthly gross', type: 'money', default: 80000 },
      { name: 'monthlyBasic', label: 'Monthly basic + DA', type: 'money', default: 40000 },
      { name: 'joiningDate', label: 'Joining date', type: 'date', default: '2018-06-01' },
      { name: 'lastWorkingDate', label: 'Last working date', type: 'date', default: '2025-08-20' },
      { name: 'leaveDaysBalance', label: 'Leave days outstanding', type: 'number', default: 24, min: 0 },
      { name: 'unpaidDays', label: 'Loss-of-pay days in the final month', type: 'number', default: 0, min: 0 },
      { name: 'noticePeriodDays', label: 'Notice period, days', type: 'number', default: 60, min: 0 },
      { name: 'noticeDaysServed', label: 'Notice days served', type: 'number', default: 60, min: 0 },
      {
        name: 'separationReason',
        label: 'Reason for separation',
        type: 'select',
        default: 'resignation',
        options: SEPARATION_OPTIONS,
      },
      { name: 'state', label: 'State', type: 'select', default: 'Karnataka', options: stateOptions() },
    ],
    run(values) {
      const result = calculateFnf({
        monthlyGross: num(values, 'monthlyGross'),
        monthlyBasic: num(values, 'monthlyBasic'),
        joiningDate: text(values, 'joiningDate', '2018-06-01'),
        lastWorkingDate: text(values, 'lastWorkingDate', '2025-08-20'),
        leaveDaysBalance: num(values, 'leaveDaysBalance'),
        unpaidDays: num(values, 'unpaidDays'),
        noticePeriodDays: num(values, 'noticePeriodDays'),
        noticeDaysServed: num(values, 'noticeDaysServed'),
        separationReason: text(values, 'separationReason', 'resignation'),
        state: text(values, 'state', 'Karnataka'),
      });

      return {
        headline: {
          label: result.employeeOwesCompany ? 'Recoverable from the employee' : 'Net payable',
          value: result.netPayable.format(),
        },
        rows: [
          ...result.earningLines().map(([label, amount]) => row(label, amount)),
          row('Gross earnings', result.grossEarnings, true),
          ...result.deductionLines().map(([label, amount]) => row(label, amount)),
          row('Total deductions', result.totalDeductions, true),
          row('Net payable', result.netPayable, true),
        ],
        note: result.gratuityIneligibilityReason ?? result.notes[0],
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'epfo-penalty-calculator',
    element: 'payroll-epfo-penalty-calculator',
    name: 'EPFO Penalty Calculator',
    tagline: 'Interest under section 7Q and damages under 14B on delayed PF deposits.',
    fields: [
      { name: 'contributionAmount', label: 'Contribution in arrears', type: 'money', default: 250000 },
      { name: 'wageMonth', label: 'Wage month', type: 'date', default: '2025-04-01' },
      { name: 'actualPaymentDate', label: 'Date actually paid', type: 'date', default: '2025-09-30' },
    ],
    run(values) {
      const result = calculateEpfoPenalty({
        contributionAmount: num(values, 'contributionAmount'),
        wageMonth: text(values, 'wageMonth', '2025-04-01'),
        actualPaymentDate: text(values, 'actualPaymentDate', '2025-09-30'),
      });

      return {
        headline: { label: 'Total payable', value: result.total.format() },
        rows: [
          row('Contribution in arrears', result.contributionAmount),
          { label: 'Due date', value: result.toArray().due_date as string },
          { label: 'Delay', value: `${result.delayDays} days` },
          row('Interest under 7Q', result.interest),
          row('Damages under 14B', result.damages),
          row('Total payable', result.total, true),
        ],
        note: result.damagesCappedAtArrears
          ? "Section 14B's proviso caps damages at the amount of the arrears."
          : undefined,
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'compliance-calendar',
    element: 'payroll-compliance-calendar',
    name: 'Compliance Calendar',
    tagline: 'Month-by-month due dates for PF, ESI, TDS, GST, PT and Form 16.',
    fields: [
      { name: 'financialYear', label: 'Financial year', type: 'text', default: '2025-26' },
      { name: 'qrmp', label: 'GST filed quarterly under QRMP', type: 'checkbox', default: false },
    ],
    run(values) {
      const result = complianceCalendar({
        financialYear: text(values, 'financialYear', '2025-26'),
        qrmp: flag(values, 'qrmp'),
      });

      return {
        headline: { label: 'Dated obligations', value: String(result.events.length) },
        rows: [],
        events: result.events,
        note: result.unscheduled.length > 0 ? `${result.unscheduled[0].code}: ${result.unscheduled[0].reason}` : undefined,
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'roi-calculator',
    element: 'payroll-roi-calculator',
    name: 'Payroll ROI Calculator',
    tagline: 'Quantify the return on moving off manual payroll.',
    fields: [
      { name: 'employeeCount', label: 'Employees on payroll', type: 'number', default: 120, min: 1 },
      { name: 'hourlyRate', label: 'Loaded hourly cost of the payroll team', type: 'money', default: 800 },
      { name: 'hoursPerCycleManual', label: 'Hours per payroll cycle today', type: 'number', default: 24, min: 0 },
      { name: 'cyclesPerYear', label: 'Cycles a year', type: 'number', default: 12, min: 1 },
      { name: 'automationEfficiency', label: 'Share of that time automation removes', type: 'number', default: 0.8, min: 0, max: 1, step: 0.05 },
      { name: 'softwareAnnualCost', label: 'Software cost a year', type: 'money', default: 180000 },
      { name: 'penaltyCostPerYear', label: 'Penalties avoided a year', type: 'money', default: 0 },
      { name: 'errorCostPerYear', label: 'Cost of correcting errors a year', type: 'money', default: 0 },
    ],
    run(values) {
      const result = calculateRoi({
        employeeCount: num(values, 'employeeCount', 1),
        hourlyRate: num(values, 'hourlyRate'),
        hoursPerCycleManual: num(values, 'hoursPerCycleManual'),
        cyclesPerYear: num(values, 'cyclesPerYear', 12),
        automationEfficiency: num(values, 'automationEfficiency', 0.8),
        softwareAnnualCost: num(values, 'softwareAnnualCost'),
        penaltyCostPerYear: num(values, 'penaltyCostPerYear'),
        errorCostPerYear: num(values, 'errorCostPerYear'),
      });

      return {
        headline: { label: 'Net benefit a year', value: result.netBenefit.format() },
        rows: [
          { label: 'Manual hours a year', value: String(result.manualAnnualHours) },
          row('Cost of that effort', result.manualLabourCost),
          { label: 'Hours automation removes', value: String(result.hoursSaved) },
          row('Labour saving', result.labourSaving),
          row('Total annual saving', result.annualSaving),
          row('Software cost', result.softwareAnnualCost),
          row('Net benefit', result.netBenefit, true),
          {
            label: 'Return on investment',
            value: result.roiPercent === null ? 'undefined - no software cost' : `${result.roiPercent}%`,
            emphasis: true,
          },
          {
            label: 'Payback period',
            value: result.paybackMonths === null ? 'never at these assumptions' : `${result.paybackMonths} months`,
          },
        ],
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'savings-calculator',
    element: 'payroll-savings-calculator',
    name: 'Payroll Savings Calculator',
    tagline: 'Estimate annual savings against another payroll provider, per employee.',
    fields: [
      { name: 'employeeCount', label: 'Employees on payroll', type: 'number', default: 120, min: 1 },
      { name: 'currentPerEmployeePerMonth', label: 'Current cost per employee per month', type: 'money', default: 120 },
      { name: 'proposedPerEmployeePerMonth', label: 'Proposed cost per employee per month', type: 'money', default: 70 },
      { name: 'currentAnnualPlatformFee', label: 'Current platform fee a year', type: 'money', default: 60000 },
      { name: 'proposedAnnualPlatformFee', label: 'Proposed platform fee a year', type: 'money', default: 0 },
      { name: 'migrationCost', label: 'One-off migration cost', type: 'money', default: 25000 },
      { name: 'contractMonths', label: 'Contract term, months', type: 'number', default: 12, min: 1 },
    ],
    run(values) {
      const result = calculateSavings({
        employeeCount: num(values, 'employeeCount', 1),
        currentPerEmployeePerMonth: num(values, 'currentPerEmployeePerMonth'),
        proposedPerEmployeePerMonth: num(values, 'proposedPerEmployeePerMonth'),
        currentAnnualPlatformFee: num(values, 'currentAnnualPlatformFee'),
        proposedAnnualPlatformFee: num(values, 'proposedAnnualPlatformFee'),
        migrationCost: num(values, 'migrationCost'),
        contractMonths: num(values, 'contractMonths', 12),
      });

      return {
        headline: {
          label: result.proposalCostsMore ? 'Additional cost a year' : 'Annual saving',
          value: result.annualSaving.format(),
        },
        rows: [
          row('Current annual cost', result.currentAnnualTotal),
          row('Proposed annual cost', result.proposedAnnualTotal),
          row('Annual saving', result.annualSaving, true),
          row('Saving per employee a year', result.perEmployeeAnnualSaving),
          row('First year, net of migration', result.firstYearSaving),
          {
            label: 'Break-even on migration',
            value:
              result.breakEvenMonths === null ? 'never - nothing is saved' : `${result.breakEvenMonths} months`,
          },
          row(`Saving over the ${result.contractMonths}-month term`, result.contractTermSaving, true),
        ],
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'payslip-generator',
    element: 'payroll-payslip-generator',
    name: 'Payslip Generator',
    tagline: 'A section 13A wage slip for one month, prorated on the month’s own length.',
    fields: [
      { name: 'employeeName', label: 'Employee name', type: 'text', default: 'Asha Menon' },
      { name: 'employeeCode', label: 'Employee code', type: 'text', default: 'EMP-0001' },
      { name: 'monthlyGross', label: 'Monthly gross', type: 'money', default: 75000 },
      { name: 'monthlyBasic', label: 'Monthly basic + DA', type: 'money', default: 30000 },
      {
        name: 'payMonth',
        label: 'Wage month',
        type: 'date',
        default: '2025-08-01',
        hint: 'Loss of pay is divided by this month’s own length, never by a flat thirty.',
      },
      { name: 'daysPayable', label: 'Days payable', type: 'number', default: 31, min: 0, max: 31 },
      { name: 'lopDays', label: 'Loss-of-pay days', type: 'number', default: 0, min: 0, max: 31 },
      { name: 'state', label: 'State', type: 'select', default: 'Karnataka', options: stateOptions() },
    ],
    run(values) {
      const result = calculatePayslip({
        employeeName: text(values, 'employeeName', 'Asha Menon'),
        employeeCode: text(values, 'employeeCode', 'EMP-0001'),
        monthlyGross: num(values, 'monthlyGross'),
        monthlyBasic: num(values, 'monthlyBasic'),
        payMonth: text(values, 'payMonth', '2025-08-01'),
        daysPayable: num(values, 'daysPayable', 31),
        lopDays: num(values, 'lopDays'),
        state: text(values, 'state', 'Karnataka'),
      });

      return {
        headline: {
          label: result.netPay.isNegative() ? 'Recoverable from the employee' : 'Net pay',
          value: result.netPay.format(),
        },
        rows: [
          { label: 'Paid days', value: `${result.paidDays} of ${result.daysInMonth}` },
          ...result.earningLines().map(([label, amount]) => row(label, amount)),
          row('Gross earnings', result.grossEarnings, true),
          ...result.deductionLines().map(([label, amount]) => row(label, amount)),
          row('Total deductions', result.totalDeductions, true),
          row('Net pay', result.netPay, true),
          { label: 'Net pay in words', value: result.netPayInWords },
        ],
        note: result.notes[0],
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'invoice-generator',
    element: 'payroll-invoice-generator',
    name: 'Invoice Generator',
    tagline: 'A GST tax invoice: CGST and SGST within a state, IGST across one.',
    fields: [
      { name: 'invoiceNumber', label: 'Invoice number', type: 'text', default: 'INV-2025-0001' },
      { name: 'invoiceDate', label: 'Invoice date', type: 'date', default: '2025-08-01' },
      {
        name: 'sellerState',
        label: 'Supplier state',
        type: 'select',
        default: 'Karnataka',
        options: gstStateOptions(),
      },
      {
        name: 'buyerState',
        label: 'Place of supply',
        type: 'select',
        default: 'Karnataka',
        options: gstStateOptions(),
        hint: 'Same state as the supplier splits the slab into CGST and SGST; a different one is IGST.',
      },
      { name: 'description', label: 'Description', type: 'text', default: 'Payroll processing services' },
      { name: 'sac', label: 'HSN or SAC', type: 'text', default: '998221' },
      { name: 'quantity', label: 'Quantity', type: 'number', default: 1, min: 0, step: 0.001 },
      { name: 'rate', label: 'Rate', type: 'money', default: 50000 },
      { name: 'discount', label: 'Discount shown on the invoice', type: 'money', default: 0 },
      {
        name: 'gstRate',
        label: 'GST rate',
        type: 'select',
        default: '18',
        options: GST_SLAB_OPTIONS,
      },
      {
        name: 'buyerGstin',
        label: 'Buyer GSTIN',
        type: 'text',
        default: '',
        hint: 'Optional - an unregistered recipient has none. The MOD-36 checksum is verified.',
      },
      { name: 'reverseCharge', label: 'Tax payable on reverse charge', type: 'checkbox', default: false },
    ],
    run(values) {
      const invoiceDate = text(values, 'invoiceDate', '2025-08-01');

      const result = calculateInvoice({
        invoiceNumber: text(values, 'invoiceNumber', 'INV-2025-0001'),
        invoiceDate,
        sellerState: text(values, 'sellerState', 'Karnataka'),
        buyerState: text(values, 'buyerState', 'Karnataka'),
        buyerGstin: text(values, 'buyerGstin'),
        reverseCharge: flag(values, 'reverseCharge'),
        items: [
          {
            description: text(values, 'description', 'Payroll processing services'),
            sac: text(values, 'sac', '998221'),
            quantity: num(values, 'quantity', 1),
            rate: num(values, 'rate'),
            discount: num(values, 'discount'),
            gstRate: num(values, 'gstRate', 18),
          },
        ],
      });

      return {
        headline: { label: 'Invoice total', value: result.grandTotal.format() },
        rows: [
          { label: 'Place of supply', value: `${result.buyerState} (${result.buyerStateCode})` },
          { label: 'Tax head', value: result.taxHead() },
          row('Taxable value', result.taxableTotal, true),
          ...(result.isInterState()
            ? [row('IGST', result.igst)]
            : [row('CGST', result.cgst), row('SGST', result.sgst)]),
          row('Total tax', result.totalTax),
          row('Round off under section 170', result.roundOff),
          row('Invoice total', result.grandTotal, true),
          { label: 'In words', value: result.amountInWords() },
        ],
        note: result.warnings[0] ?? result.reverseChargeDeclaration ?? undefined,
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
  {
    slug: 'salary-templates',
    element: 'payroll-salary-templates',
    name: 'Salary Templates',
    tagline: 'The four payroll spreadsheets as column schemas with worked sample rows.',
    fields: [
      {
        name: 'template',
        label: 'Template',
        type: 'select',
        default: 'structure',
        options: TEMPLATE_OPTIONS,
      },
      { name: 'annualCtc', label: 'Reference annual CTC', type: 'money', default: 1200000 },
      { name: 'employeeCount', label: 'Sample employee rows', type: 'number', default: 25, min: 1, max: 5000 },
      { name: 'state', label: 'State', type: 'select', default: 'Karnataka', options: stateOptions() },
      taxYearField(),
    ],
    run(values) {
      const result = calculateSalaryTemplate({
        template: text(values, 'template', 'structure'),
        annualCtc: num(values, 'annualCtc'),
        employeeCount: num(values, 'employeeCount', 25),
        state: text(values, 'state', 'Karnataka'),
        asOf: taxYearAsOf(values),
      });

      return {
        headline: {
          label: `${result.title} - columns × sample rows`,
          value: `${result.columnCount()} × ${result.rowCount()}`,
        },
        rows: result.columns.map((column) => ({
          label: `${column.letter} · ${column.header}`,
          value: column.formula === null ? column.type : result.formulaFor(column.key, result.firstDataRow())!,
          muted: column.formula === null,
        })),
        note: result.notes[0],
        explanation: result.explain(),
        workings: result.workings,
        citations: result.citations,
      };
    },
  },
];

export const TOOLS_BY_SLUG: Record<string, ToolDefinition> = Object.fromEntries(
  TOOLS.map((tool) => [tool.slug, tool]),
);

/** Resolve a `data-payroll` value, tolerating the short form ("gratuity"). */
export function findTool(name: string): ToolDefinition | undefined {
  const needle = name.trim().toLowerCase();

  return (
    TOOLS_BY_SLUG[needle] ??
    TOOLS.find((tool) => tool.element === needle) ??
    TOOLS.find((tool) => tool.slug.replace(/-calculator$/, '') === needle.replace(/-calculator$/, ''))
  );
}
