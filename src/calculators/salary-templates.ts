import { type DateInput, addMonths, daysInMonth, firstDayOfMonth, formatDate, month as monthOf, toDate } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, rateLabel } from '../money.js';
import { RateRepository, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';
import { CtcCalculator, type CtcResult } from './ctc.js';

const TEMPLATES = ['structure', 'register', 'slip', 'master'] as const;

export type SalaryTemplateName = (typeof TEMPLATES)[number];

/**
 * A register is a sample, not a payroll run. The ceiling is here so that a
 * mistyped employee count cannot ask for a million CTC breakdowns; it matches the
 * bound the shipped HTTP layer validates against.
 */
const MAX_EMPLOYEE_ROWS = 5000;

const DEFAULT_ANNUAL_CTC = 12_00_000;

/**
 * The sample register needs an employee ESI covers and an employee it does not,
 * whatever reference CTC the caller passed - otherwise half the register's
 * formulae are never demonstrated. Both anchors are expressed as multiples of the
 * ESI wage limit read from the rate table rather than as rupee figures, so a
 * revision to the limit moves them with it.
 *
 * A monthly CTC pinned at the wage limit always leaves a gross below it, because
 * employer PF and the gratuity provision come out of the CTC first. Sixty per
 * cent above the limit clears it just as reliably.
 */
const ESI_COVERED_ANCHOR_MONTHS = 12;
const ESI_UNCOVERED_ANCHOR_MONTHS = 19.2;

interface SampleBand {
  multiplier: number;
  designation: string;
  department: string;
}

/**
 * The sample payroll: a spread of seniority around the reference CTC, with the
 * designation and the multiplier fixed together so that a trainee never out-earns
 * a manager in the example a customer opens first.
 */
const SAMPLE_BANDS: SampleBand[] = [
  { multiplier: 1.0, designation: 'Software Engineer', department: 'Engineering' },
  { multiplier: 0.62, designation: 'Associate', department: 'Customer Support' },
  { multiplier: 1.45, designation: 'Senior Engineer', department: 'Engineering' },
  { multiplier: 0.86, designation: 'Executive', department: 'Finance' },
  { multiplier: 2.1, designation: 'Engineering Manager', department: 'Engineering' },
  { multiplier: 0.74, designation: 'Associate', department: 'Operations' },
  { multiplier: 1.18, designation: 'Analyst', department: 'Finance' },
  { multiplier: 0.5, designation: 'Trainee', department: 'Operations' },
  { multiplier: 1.75, designation: 'Team Lead', department: 'Sales' },
  { multiplier: 0.95, designation: 'HR Executive', department: 'Human Resources' },
];

const SAMPLE_FIRST_NAMES = [
  'Aarav',
  'Diya',
  'Rohan',
  'Meera',
  'Kabir',
  'Ananya',
  'Vikram',
  'Sneha',
  'Arjun',
  'Priya',
  'Nikhil',
  'Ishita',
];

const SAMPLE_LAST_NAMES = [
  'Sharma',
  'Nair',
  'Iyer',
  'Banerjee',
  'Patel',
  'Reddy',
  'Kulkarni',
  'Menon',
  'Chauhan',
  'Das',
];

const SAMPLE_BANKS = [
  'State Bank of India',
  'HDFC Bank',
  'ICICI Bank',
  'Axis Bank',
  'Kotak Mahindra Bank',
];

/**
 * The register and the slip have a statutory column list behind them. It is not
 * in any rate table - it is a format, not a rate - so it is cited from the statute
 * directly.
 */
const REGISTER_CITATION =
  'Payment of Wages Act 1936, section 13A read with rule 27 of the Code on Wages (Central) Rules 2021 - ' +
  'the particulars a register of wages must carry';

const SLIP_CITATION =
  'Payment of Wages Act 1936, section 13A - the particulars a wage slip must carry';

/**
 * Why every identifier in the sample is deliberately malformed.
 *
 * A template ships to strangers and gets filled in by copying the example row. An
 * example carrying a well-formed PAN or a twelve-digit UAN is a well-formed PAN or
 * UAN belonging to somebody, and it will eventually be submitted in a return.
 * Placeholders that cannot pass validation fail loudly instead.
 */
const PLACEHOLDER_NOTE =
  'Every identifier in the sample rows - PAN, UAN, ESIC insurance number, bank account and IFSC - is a ' +
  'deliberately invalid placeholder such as SAMPLE-PAN-001, so that no value shipped in a template can be ' +
  "mistaken for a real person's and none can pass a portal's validation by accident.";

export interface SalaryTemplateInput {
  /** One of structure, register, slip, master. */
  template?: string;
  /** Rows the register and master are drawn up for. */
  employeeCount?: number;
  /** The CTC the worked example is built at; ₹12,00,000 when omitted. */
  annualCtc?: Money | number | string | null;
  /** The state whose professional tax schedule the sample uses. */
  state?: string;
  /** Selects the statutory version and dates the sample. */
  asOf?: DateInput;
}

export interface TemplateColumn {
  key: string;
  header: string;
  type: string;
  width: number;
  letter: string;
  formula: string | null;
}

export type TemplateCell = Money | Date | string | number | null;
export type TemplateRow = Record<string, TemplateCell>;

/** A compact column definition: key, header, type, width and an optional formula. */
type ColumnDefinition = [key: string, header: string, type: string, width: number, formula?: string];

interface SampleEmployee {
  code: string;
  name: string;
  department: string;
  designation: string;
  annual_ctc: Money;
  joined: Date;
  pan: string;
  uan: string;
  esic_number: string;
  bank_name: string;
  bank_account_number: string;
  ifsc: string;
}

/**
 * The definition of one payroll spreadsheet: its columns, the formulae between
 * them, and worked sample rows.
 *
 * There is no file here and there never will be. A column carries a key, a
 * header, a type, a width and - where the cell is computed rather than entered -
 * an Excel formula in A1 notation with the row number left as a `{row}`
 * placeholder, because the same formula has to be written down every data row and
 * only the writer knows which row it is on. Whoever writes the workbook
 * substitutes the row and gets a live sheet; whoever reads the JSON gets the same
 * schema without needing a spreadsheet library at all.
 *
 * The sample rows are not invented. Every figure in them comes back from the same
 * calculators the rest of this package exposes, so a template shipped to a payroll
 * team is arithmetically correct on the day it is opened rather than merely
 * plausible.
 */
export class SalaryTemplateResult extends Result {
  /**
   * Headers occupy the first sheet row, so the first row of data is the second.
   * Formulae are written relative to whichever row they land on, and this is
   * where that counting starts.
   */
  static readonly HEADER_ROW = 1;

  constructor(
    readonly template: string,
    readonly title: string,
    readonly columns: TemplateColumn[],
    readonly rows: TemplateRow[],
    readonly annualCtc: Money,
    readonly state: string,
    readonly employeeCount: number,
    readonly notes: string[] = [],
  ) {
    super();
  }

  /**
   * A template is a schema, not a sum. The headline "amount" is the package the
   * worked example was built at, so the result still satisfies the shape every
   * other calculator returns.
   */
  get amount(): Money {
    return this.annualCtc;
  }

  static make(
    steps: Step[],
    citations: string[],
    fields: ConstructorParameters<typeof SalaryTemplateResult>,
  ): SalaryTemplateResult {
    return new SalaryTemplateResult(...fields).withWorking(steps, citations);
  }

  columnCount(): number {
    return this.columns.length;
  }

  rowCount(): number {
    return this.rows.length;
  }

  /** The header row, in sheet order. */
  headers(): string[] {
    return this.columns.map((column) => column.header);
  }

  keys(): string[] {
    return this.columns.map((column) => column.key);
  }

  /** The sheet row the first data row lands on. */
  firstDataRow(): number {
    return SalaryTemplateResult.HEADER_ROW + 1;
  }

  /**
   * The sheet row the last data row lands on. Equal to the first data row less
   * one when there are no rows at all, which is the empty range a writer wants
   * rather than a row that does not exist.
   */
  lastDataRow(): number {
    return SalaryTemplateResult.HEADER_ROW + this.rowCount();
  }

  column(key: string): TemplateColumn {
    const found = this.columns.find((column) => column.key === key);

    if (!found) {
      throw InvalidInputError.unknownOption('column', key, this.keys());
    }

    return found;
  }

  /**
   * The A1 column letter a key was assigned, for a caller writing the sheet
   * itself rather than reading the formulae back.
   */
  letterFor(key: string): string {
    return this.column(key).letter;
  }

  /**
   * The formula for one computed column, bound to a concrete sheet row. Null for
   * a column the user types into.
   */
  formulaFor(key: string, row: number): string | null {
    const formula = this.column(key).formula;

    if (formula === null) {
      return null;
    }

    if (row < 1) {
      throw InvalidInputError.outOfRange('row', 'a sheet row of 1 or more', row);
    }

    return formula.replace(/\{row\}/g, String(row));
  }

  /**
   * Every computed column bound to one sheet row, keyed by column key - the shape
   * a writer loops over once per data row.
   */
  formulas(row: number): Record<string, string> {
    const formulas: Record<string, string> = {};

    for (const column of this.columns) {
      const formula = this.formulaFor(column.key, row);

      if (formula !== null) {
        formulas[column.key] = formula;
      }
    }

    return formulas;
  }

  explain(): string {
    return (
      `${this.title}: ${this.columnCount()} columns and ${this.rowCount()} sample ` +
      `${this.rowCount() === 1 ? 'row' : 'rows'}, worked at ${this.annualCtc.format()} a year in ` +
      `${this.state}. The sample figures come from the calculators themselves; the template is a ` +
      'definition, not a file.'
    );
  }

  toArray(): Record<string, unknown> {
    return {
      template: this.template,
      title: this.title,
      state: this.state,
      employee_count: this.employeeCount,
      annual_ctc: this.annualCtc.toRupees(),
      annual_ctc_formatted: this.annualCtc.format(),

      column_count: this.columnCount(),
      row_count: this.rowCount(),
      header_row: SalaryTemplateResult.HEADER_ROW,
      first_data_row: this.firstDataRow(),
      last_data_row: this.lastDataRow(),

      headers: this.headers(),
      columns: this.columns.map((column) => ({
        ...column,
        formula_first_row: this.formulaFor(column.key, this.firstDataRow()),
      })),
      rows: this.rows.map((row) => this.rowToArray(row)),

      notes: this.notes,
    };
  }

  /**
   * One sample row flattened for the wire: money as rupees plus a formatted twin,
   * dates as ISO plus the day-month-year a payroll team reads, and the columns in
   * sheet order so a consumer can zip rows against headers.
   */
  private rowToArray(row: TemplateRow): Record<string, string | number | null> {
    const flat: Record<string, string | number | null> = {};

    for (const column of this.columns) {
      const value = row[column.key] ?? null;

      if (value instanceof Money) {
        flat[column.key] = value.toRupees();
        flat[`${column.key}_formatted`] = value.format();

        continue;
      }

      if (value instanceof Date) {
        flat[column.key] = formatDate(value, 'Y-m-d');
        flat[`${column.key}_formatted`] = formatDate(value, 'd-m-Y');

        continue;
      }

      flat[column.key] = value;
    }

    return flat;
  }
}

/**
 * The four spreadsheets a payroll team keeps, defined rather than written: the
 * salary structure, the monthly register, the salary slip and the employee master.
 *
 * What comes back is a column schema - keys, headers, types, widths and the Excel
 * formulae between the columns - together with sample rows. The rows are produced
 * by running CtcCalculator, which is the whole point: a template whose worked
 * example is invented teaches a payroll team the wrong arithmetic, and they will
 * copy it. Everything here therefore reconciles the way the real calculation does,
 * down to the paise.
 *
 * No file is produced and none ever should be. Turning this definition into an
 * XLSX is a host application's job, because a calculation package that reaches for
 * a spreadsheet writer has picked a dependency on its callers' behalf.
 */
export class SalaryTemplateBuilder {
  private readonly ctcCalculator: CtcCalculator;

  /**
   * The peer calculator is injectable, but its default is built on *this*
   * repository rather than on one of its own. A caller pointing the builder at a
   * different rate directory expects the worked example to follow.
   */
  constructor(
    private readonly rates: RateRepository = defaultRates,
    ctcCalculator?: CtcCalculator,
  ) {
    this.ctcCalculator = ctcCalculator ?? new CtcCalculator(rates);
  }

  /** The templates this builder knows, for a caller building a picker. */
  static templates(): SalaryTemplateName[] {
    return [...TEMPLATES];
  }

  calculate(input: SalaryTemplateInput = {}): SalaryTemplateResult {
    const chosen = String(input.template ?? 'structure').trim().toLowerCase();

    if (!(TEMPLATES as readonly string[]).includes(chosen)) {
      throw InvalidInputError.unknownOption('template', String(input.template ?? ''), TEMPLATES);
    }

    const employeeCount = input.employeeCount ?? 25;

    if (employeeCount < 1) {
      throw InvalidInputError.outOfRange('Employee count', 'at least 1', employeeCount);
    }

    if (employeeCount > MAX_EMPLOYEE_ROWS) {
      throw InvalidInputError.outOfRange(
        'Employee count',
        `at most ${MAX_EMPLOYEE_ROWS} sample rows`,
        employeeCount,
      );
    }

    const annualCtc =
      input.annualCtc === null || input.annualCtc === undefined
        ? Money.fromRupees(DEFAULT_ANNUAL_CTC)
        : Money.from(input.annualCtc);

    if (annualCtc.isNegative()) {
      throw InvalidInputError.negative('Annual CTC');
    }

    const state = input.state ?? 'Karnataka';
    const asOf = input.asOf ?? null;
    const on = toDate(asOf);

    switch (chosen) {
      case 'register':
        return this.register(annualCtc, state, employeeCount, on, asOf);
      case 'slip':
        return this.slip(annualCtc, state, employeeCount, on, asOf);
      case 'master':
        return this.master(annualCtc, state, employeeCount, on, asOf);
      default:
        return this.structure(annualCtc, state, employeeCount, asOf);
    }
  }

  /**
   * One row per component of a single employee's package, monthly and annual.
   *
   * The rows that are not totals add back to the cost to company exactly, which
   * is the property the whole structure exists to demonstrate: special allowance
   * is a balancing figure, so moving money between basic and HRA moves it between
   * rows and nowhere else.
   */
  private structure(
    annualCtc: Money,
    state: string,
    employeeCount: number,
    asOf: DateInput,
  ): SalaryTemplateResult {
    const ctc = this.ctcCalculator.calculate({ annualCtc, state, asOf });

    const columns = buildColumns([
      ['component', 'Component', 'text', 34],
      ['category', 'Category', 'text', 24],
      ['monthly', 'Monthly (₹)', 'money', 16],
      ['annual', 'Annual (₹)', 'formula', 16, '={monthly}{row}*12'],
      ['basis', 'How it is arrived at', 'text', 52],
    ]);

    const esiBasis = ctc.esi.applicable
      ? `${rateLabel(ctc.esi.employerRate)}% of gross salary, rounded up to the rupee`
      : `nil - gross salary exceeds the ${ctc.esi.wageLimit.format()} ESI wage limit`;

    const rows: TemplateRow[] = [
      structureRow('Basic', 'Earning', ctc.basic, `${rateLabel(ctc.basicPercent)}% of monthly cost to company`),
      structureRow('House rent allowance', 'Earning', ctc.hra, `${rateLabel(ctc.hraPercent)}% of basic`),
      structureRow(
        'Special allowance',
        'Earning',
        ctc.specialAllowance,
        'the balancing figure: gross less basic less HRA',
      ),
      structureRow('Gross salary', 'Total', ctc.grossSalary, 'basic + HRA + special allowance'),
      structureRow(
        'Employer provident fund',
        'Employer contribution',
        ctc.employerPf,
        `12% of PF wages (EPF ${ctc.employerEpf.format()} + EPS ${ctc.employerEps.format()})`,
      ),
      structureRow('Employer ESI', 'Employer contribution', ctc.employerEsi, esiBasis),
      structureRow(
        'Gratuity provision',
        'Employer contribution',
        ctc.gratuityProvision,
        'fifteen days of basic a year ÷ 26 ÷ 12',
      ),
      structureRow(
        'Total employer contributions',
        'Total',
        ctc.totalEmployerContributions,
        'employer PF + employer ESI + gratuity provision',
      ),
      structureRow(
        'Cost to company',
        'Total',
        ctc.monthlyCtc,
        'gross salary + total employer contributions',
      ),
    ];

    const steps: Step[] = [
      new Step({
        label: 'Salary structure template',
        formula: `${columns.length} columns × ${rows.length} component rows`,
        context: { template: 'structure' },
      }),
      new Step({
        label: 'Worked at an annual cost to company of',
        amount: annualCtc,
        formula: `${annualCtc.format()} ÷ 12 = ${ctc.monthlyCtc.format()} a month`,
      }),
    ];

    return SalaryTemplateResult.make(
      [...steps, ...ctc.workings],
      [...ctc.citations],
      [
        'structure',
        'Salary structure',
        columns,
        rows,
        annualCtc,
        state,
        employeeCount,
        [
          'The rows that are not totals add back to the cost to company exactly. Special allowance is the ' +
            'balancing figure, so raising the basic percentage moves money between rows without changing ' +
            'the cost to company.',
          'The annual column is a formula on the monthly column rather than a stored figure, so editing a ' +
            'monthly cell in the workbook keeps the year in step.',
          ...ctc.assumptions,
        ],
      ],
    );
  }

  /**
   * One row per employee: earnings, deductions, net pay and the employer's own
   * cost, with the totals carried as formulae so the sheet stays live once a
   * payroll team starts editing it.
   */
  private register(
    annualCtc: Money,
    state: string,
    employeeCount: number,
    on: Date,
    asOf: DateInput,
  ): SalaryTemplateResult {
    const esi = this.rates.for('esi', asOf);
    const wageLimit = esi.money('wage_limit');

    const columns = buildColumns([
      ['employee_code', 'Employee code', 'text', 16],
      ['employee_name', 'Employee name', 'text', 26],
      ['days_paid', 'Days paid', 'number', 11],
      ['basic', 'Basic (₹)', 'money', 14],
      ['hra', 'HRA (₹)', 'money', 14],
      ['special_allowance', 'Special allowance (₹)', 'money', 20],
      [
        'gross_earnings',
        'Gross earnings (₹)',
        'formula',
        18,
        '={basic}{row}+{hra}{row}+{special_allowance}{row}',
      ],
      ['employee_pf', 'PF - employee (₹)', 'money', 18],
      ['employee_esi', 'ESI - employee (₹)', 'money', 18],
      ['professional_tax', 'Professional tax (₹)', 'money', 19],
      ['tds', 'TDS (₹)', 'money', 13],
      [
        'total_deductions',
        'Total deductions (₹)',
        'formula',
        20,
        '={employee_pf}{row}+{employee_esi}{row}+{professional_tax}{row}+{tds}{row}',
      ],
      ['net_pay', 'Net pay (₹)', 'formula', 15, '={gross_earnings}{row}-{total_deductions}{row}'],
      ['employer_pf', 'PF - employer (₹)', 'money', 18],
      ['employer_esi', 'ESI - employer (₹)', 'money', 18],
      ['gratuity_provision', 'Gratuity provision (₹)', 'money', 21],
      [
        'cost_to_company',
        'Cost to company (₹)',
        'formula',
        19,
        '={gross_earnings}{row}+{employer_pf}{row}+{employer_esi}{row}+{gratuity_provision}{row}',
      ],
    ]);

    const roster = this.roster(employeeCount, annualCtc, wageLimit, on);
    const daysPaid = daysInMonth(on);

    /** Keyed by annual CTC in paise. */
    const computed = new Map<number, CtcResult>();
    const rows: TemplateRow[] = [];
    let covered = 0;

    for (const employee of roster) {
      const paise = employee.annual_ctc.paise;

      // Half the sample sits on repeated CTCs, and a full breakdown is a PF, ESI,
      // professional tax and slab computation each time. Two employees on the
      // same package have the same structure, so it is computed once.
      let structure = computed.get(paise);

      if (structure === undefined) {
        structure = this.ctcCalculator.calculate({ annualCtc: employee.annual_ctc, state, asOf });
        computed.set(paise, structure);
      }

      if (structure.esi.applicable) {
        covered += 1;
      }

      rows.push({
        employee_code: employee.code,
        employee_name: employee.name,
        days_paid: daysPaid,
        basic: structure.basic,
        hra: structure.hra,
        special_allowance: structure.specialAllowance,
        gross_earnings: structure.grossSalary,
        employee_pf: structure.employeePf,
        employee_esi: structure.employeeEsi,
        professional_tax: structure.professionalTax,
        tds: structure.tds,
        total_deductions: structure.totalDeductions,
        net_pay: structure.netInHand,
        employer_pf: structure.employerPf,
        employer_esi: structure.employerEsi,
        gratuity_provision: structure.gratuityProvision,
        cost_to_company: structure.monthlyCtc,
      });
    }

    const notes = [
      `Days paid is the full length of ${formatDate(on, 'F Y')}. A register in use carries the days ` +
        'actually paid, and the earnings columns are pro-rated on it.',
      `ESI applies to ${covered} of the ${rows.length} sample employees. The sample CTCs are spread ` +
        `around the reference so that the ESI columns are demonstrated both ways - an employee inside ` +
        `the ${wageLimit.format()} wage limit pays and one above it does not.`,
    ];

    if (employeeCount < 3) {
      notes.push(
        'With fewer than three rows the sample cannot show every case; ask for more rows to see ' +
          'both sides of the ESI wage limit.',
      );
    }

    const [low, high] = rosterRange(roster);

    const steps: Step[] = [
      new Step({
        label: 'Monthly salary register template',
        formula: `${columns.length} columns × ${rows.length} employee rows`,
        citation: REGISTER_CITATION,
        context: { template: 'register' },
      }),
      new Step({
        label: 'ESI wage limit the sample straddles',
        amount: wageLimit,
        formula: 'gross wages at or below the limit are covered; above it they are not',
        citation: esi.citation(),
        context: { covered_rows: covered, uncovered_rows: rows.length - covered },
      }),
      new Step({
        label: 'Reference cost to company the sample varies around',
        amount: annualCtc,
        formula: `sample CTCs run ${low.format()} to ${high.format()} a year`,
      }),
    ];

    return SalaryTemplateResult.make(
      steps,
      [REGISTER_CITATION, esi.citation(), ...registerCitations(computed)],
      [
        'register',
        'Monthly salary register',
        columns,
        rows,
        annualCtc,
        state,
        employeeCount,
        notes,
      ],
    );
  }

  /**
   * The payslip as a column schema: a section, the particular, and the money
   * columns a wage slip has to show.
   *
   * A slip is not really a grid, which is exactly why it is worth pinning down as
   * one - the employee particulars, the attendance and the two money columns all
   * have to sit somewhere, and a template that leaves that to the person building
   * the workbook gets a different slip every time.
   */
  private slip(
    annualCtc: Money,
    state: string,
    employeeCount: number,
    on: Date,
    asOf: DateInput,
  ): SalaryTemplateResult {
    const ctc = this.ctcCalculator.calculate({ annualCtc, state, asOf });
    const employee = this.roster(1, annualCtc, this.rates.for('esi', asOf).money('wage_limit'), on)[0];

    const columns = buildColumns([
      ['section', 'Section', 'text', 16],
      ['particular', 'Particular', 'text', 34],
      ['current_month', 'This month (₹)', 'money', 16],
      ['arrears', 'Arrears (₹)', 'money', 14],
      ['total', 'Total (₹)', 'formula', 15, '={current_month}{row}+{arrears}{row}'],
      ['year_to_date', 'Year to date (₹)', 'money', 18],
      ['remarks', 'Remarks', 'text', 40],
    ]);

    // Section 192 runs on the financial year, so a payslip's year-to-date column
    // counts from April rather than from January.
    const monthsElapsed = ((monthOf(on) - 4 + 12) % 12) + 1;
    const days = daysInMonth(on);

    const particular = (label: string, value: string): TemplateRow => ({
      section: 'Employee',
      particular: label,
      current_month: null,
      arrears: null,
      total: null,
      year_to_date: null,
      remarks: value,
    });

    const money = (section: string, label: string, amount: Money, remark: string): TemplateRow => ({
      section,
      particular: label,
      current_month: amount,
      arrears: Money.zero(),
      total: amount,
      year_to_date: amount.multiply(monthsElapsed),
      remarks: remark,
    });

    const attendance = (label: string, value: string): TemplateRow => ({
      section: 'Attendance',
      particular: label,
      current_month: null,
      arrears: null,
      total: null,
      year_to_date: null,
      remarks: value,
    });

    const rows: TemplateRow[] = [
      particular('Employee name', employee.name),
      particular('Employee code', employee.code),
      particular('Designation', employee.designation),
      particular('Department', employee.department),
      particular('Date of joining', formatDate(employee.joined, 'd-m-Y')),
      particular('PAN', employee.pan),
      particular('UAN', employee.uan),
      particular('Bank account', employee.bank_account_number),
      particular('Wage period', formatDate(on, 'F Y')),

      attendance('Days in the wage period', String(days)),
      attendance('Days paid', String(days)),
      attendance('Loss of pay days', '0'),

      money('Earnings', 'Basic', ctc.basic, `${rateLabel(ctc.basicPercent)}% of monthly cost to company`),
      money('Earnings', 'House rent allowance', ctc.hra, `${rateLabel(ctc.hraPercent)}% of basic`),
      money('Earnings', 'Special allowance', ctc.specialAllowance, 'balancing figure'),
      money('Earnings', 'Gross earnings', ctc.grossSalary, 'basic + HRA + special allowance'),

      money('Deductions', 'Provident fund - employee', ctc.employeePf, '12% of PF wages'),
      money(
        'Deductions',
        "Employees' State Insurance",
        ctc.employeeEsi,
        ctc.esi.applicable
          ? `${rateLabel(ctc.esi.employeeRate)}% of gross, rounded up to the rupee`
          : `nil - gross exceeds the ${ctc.esi.wageLimit.format()} wage limit`,
      ),
      money(
        'Deductions',
        `Professional tax - ${ctc.state}`,
        ctc.professionalTax,
        'the annual state levy ÷ 12',
      ),
      money(
        'Deductions',
        'Tax deducted at source',
        ctc.tds,
        'section 192 liability for the year ÷ 12',
      ),
      money(
        'Deductions',
        'Total deductions',
        ctc.totalDeductions,
        'PF + ESI + professional tax + TDS',
      ),

      money('Summary', 'Net pay', ctc.netInHand, 'gross earnings less total deductions'),
      money(
        'Summary',
        'Cost to company',
        ctc.monthlyCtc,
        "not payable to the employee: it includes the employer's own contributions",
      ),
    ];

    const steps: Step[] = [
      new Step({
        label: 'Salary slip template',
        formula: `${columns.length} columns × ${rows.length} layout rows`,
        citation: SLIP_CITATION,
        context: { template: 'slip' },
      }),
      new Step({
        label: 'Year to date',
        formula:
          `${monthsElapsed} month${monthsElapsed === 1 ? '' : 's'} of the financial year completed to ` +
          `the end of ${formatDate(on, 'F Y')}`,
        context: { months_elapsed: monthsElapsed },
      }),
    ];

    return SalaryTemplateResult.make(
      [...steps, ...ctc.workings],
      [SLIP_CITATION, ...ctc.citations],
      [
        'slip',
        'Salary slip',
        columns,
        rows,
        annualCtc,
        state,
        employeeCount,
        [
          `The year-to-date column is the current month times the ${monthsElapsed} ` +
            `month${monthsElapsed === 1 ? '' : 's'} of the financial year elapsed. A slip drawn from real ` +
            'payroll history carries the actual accumulations instead.',
          'Cost to company is shown for information. It is not part of net pay and should never be added ' +
            'to the earnings side of a slip.',
          'The total column is a formula, but it belongs only on the rows that carry money. The employee ' +
            'and attendance rows leave the money columns empty and should be written as text.',
          PLACEHOLDER_NOTE,
          ...ctc.assumptions,
        ],
      ],
    );
  }

  /**
   * The employee master: the record everything else is filed from.
   *
   * The identifier columns exist because the monthly filings need them - the ECR
   * is keyed on the UAN, the ESI return on the insurance number, and the quarterly
   * TDS statement on the PAN - so those columns are cited to the statutes that
   * demand them rather than presented as house preference.
   */
  private master(
    annualCtc: Money,
    state: string,
    employeeCount: number,
    on: Date,
    asOf: DateInput,
  ): SalaryTemplateResult {
    const epf = this.rates.for('epf', asOf);
    const esi = this.rates.for('esi', asOf);

    const columns = buildColumns([
      ['employee_code', 'Employee code', 'text', 16],
      ['employee_name', 'Employee name', 'text', 26],
      ['date_of_joining', 'Date of joining', 'date', 16],
      ['department', 'Department', 'text', 20],
      ['designation', 'Designation', 'text', 24],
      ['pan', 'PAN', 'text', 18],
      ['uan', 'UAN', 'text', 18],
      ['esic_number', 'ESIC insurance number', 'text', 22],
      ['bank_name', 'Bank', 'text', 24],
      ['bank_account_number', 'Bank account number', 'text', 22],
      ['ifsc', 'IFSC', 'text', 18],
      ['annual_ctc', 'Annual CTC (₹)', 'money', 18],
      ['monthly_ctc', 'Monthly CTC (₹)', 'formula', 18, '={annual_ctc}{row}/12'],
    ]);

    const roster = this.roster(employeeCount, annualCtc, esi.money('wage_limit'), on);

    const rows: TemplateRow[] = roster.map((employee) => ({
      employee_code: employee.code,
      employee_name: employee.name,
      date_of_joining: employee.joined,
      department: employee.department,
      designation: employee.designation,
      pan: employee.pan,
      uan: employee.uan,
      esic_number: employee.esic_number,
      bank_name: employee.bank_name,
      bank_account_number: employee.bank_account_number,
      ifsc: employee.ifsc,
      annual_ctc: employee.annual_ctc,
      monthly_ctc: employee.annual_ctc.divide(12),
    }));

    const steps: Step[] = [
      new Step({
        label: 'Employee master template',
        formula: `${columns.length} columns × ${rows.length} employee rows`,
        context: { template: 'master' },
      }),
      new Step({
        label: 'Provident fund columns',
        formula: 'the universal account number is the key the monthly electronic challan is filed on',
        citation: epf.citation(),
      }),
      new Step({
        label: 'State insurance columns',
        formula: 'the insurance number is the key the monthly ESI return is filed on',
        citation: esi.citation(),
      }),
      new Step({
        label: 'Identifier columns carry placeholders, not data',
        formula:
          'no sample value is in a valid PAN, UAN, insurance number, account number or IFSC format',
      }),
    ];

    return SalaryTemplateResult.make(
      steps,
      [epf.citation(), esi.citation()],
      [
        'master',
        'Employee master',
        columns,
        rows,
        annualCtc,
        state,
        employeeCount,
        [
          PLACEHOLDER_NOTE,
          'The formats to replace them with: PAN is five letters, four digits and a letter; UAN is twelve ' +
            'digits; the ESIC insurance number is ten digits; IFSC is four letters, a zero and six ' +
            'alphanumerics; a bank account number is nine to eighteen digits.',
          'Monthly CTC is a formula on the annual column, so correcting a package in the master corrects ' +
            'the monthly figure with it.',
        ],
      ],
    );
  }

  /**
   * The sample payroll: a spread of packages around the reference CTC, with the
   * last rows pinned either side of the ESI wage limit.
   *
   * The pinning is unconditional rather than a check-and-repair pass. A register
   * generated for a reference CTC of ₹50 lakh has no naturally covered employee,
   * one generated at ₹2 lakh has no naturally uncovered employee, and in both
   * cases the columns that are never exercised are the ones a payroll team most
   * needs to see working.
   */
  private roster(
    employeeCount: number,
    annualCtc: Money,
    esiWageLimit: Money,
    on: Date,
  ): SampleEmployee[] {
    const roster: SampleEmployee[] = [];

    for (let index = 0; index < employeeCount; index += 1) {
      const band = SAMPLE_BANDS[index % SAMPLE_BANDS.length];

      roster.push(
        sampleEmployee(
          index,
          annualCtc.multiply(band.multiplier),
          band.designation,
          band.department,
          on,
        ),
      );
    }

    if (employeeCount >= 3) {
      roster[employeeCount - 2] = sampleEmployee(
        employeeCount - 2,
        esiWageLimit.multiply(ESI_UNCOVERED_ANCHOR_MONTHS),
        'Executive',
        'Operations',
        on,
      );
    }

    if (employeeCount >= 2) {
      roster[employeeCount - 1] = sampleEmployee(
        employeeCount - 1,
        esiWageLimit.multiply(ESI_COVERED_ANCHOR_MONTHS),
        'Trainee',
        'Operations',
        on,
      );
    }

    return roster;
  }
}

function sampleEmployee(
  index: number,
  annualCtc: Money,
  designation: string,
  department: string,
  on: Date,
): SampleEmployee {
  const serial = index + 1;

  // Tenures are staggered so the master shows a spread of joining dates rather
  // than a cohort that all started on the same day. The month is stepped from the
  // first of the month so that a run on the 31st does not roll a short month over
  // into the next one.
  const months = 6 + ((index * 7) % 114);
  const joined = addMonths(firstDayOfMonth(on), -months);

  return {
    code: `EMP-${String(serial).padStart(4, '0')}`,
    name: `${SAMPLE_FIRST_NAMES[index % SAMPLE_FIRST_NAMES.length]} ${
      SAMPLE_LAST_NAMES[index % SAMPLE_LAST_NAMES.length]
    }`,
    department,
    designation,
    annual_ctc: annualCtc,
    joined,
    pan: `SAMPLE-PAN-${String(serial).padStart(3, '0')}`,
    uan: `SAMPLE-UAN-${String(serial).padStart(3, '0')}`,
    esic_number: `SAMPLE-ESIC-${String(serial).padStart(3, '0')}`,
    bank_name: SAMPLE_BANKS[index % SAMPLE_BANKS.length],
    bank_account_number: `SAMPLE-ACCOUNT-${String(serial).padStart(3, '0')}`,
    ifsc: `SAMPLE-IFSC-${String(serial).padStart(3, '0')}`,
  };
}

/**
 * The lowest and highest package on the sample roster, for the step that tells a
 * reader how wide the sample is.
 */
function rosterRange(roster: SampleEmployee[]): [Money, Money] {
  const amounts = roster.map((employee) => employee.annual_ctc);
  const first = amounts.shift() ?? Money.zero();

  return [first.min(...amounts), first.max(...amounts)];
}

/**
 * The statutory basis behind the register's own figures, gathered from the
 * breakdowns that produced them. Deduplication happens in Result.
 */
function registerCitations(computed: Map<number, CtcResult>): string[] {
  const citations: string[] = [];

  for (const structure of computed.values()) {
    for (const citation of structure.citations) {
      citations.push(citation);
    }
  }

  return citations;
}

function structureRow(
  component: string,
  category: string,
  monthly: Money,
  basis: string,
): TemplateRow {
  return {
    component,
    category,
    monthly,
    annual: monthly.multiply(12),
    basis,
  };
}

/**
 * Turns a compact column definition into the shape the result exposes, assigning
 * each column its A1 letter and resolving the formulae.
 *
 * Formulae are written against column *keys* - `={basic}{row}+{hra}{row}` - and
 * only become `=D2+E2` here. Inserting a column therefore cannot silently point a
 * total at the wrong cell, which is the failure a hand-written A1 string invites.
 */
function buildColumns(definitions: ColumnDefinition[]): TemplateColumn[] {
  const letters: Record<string, string> = {};

  definitions.forEach((definition, index) => {
    letters[definition[0]] = columnLetter(index);
  });

  return definitions.map((definition) => ({
    key: definition[0],
    header: definition[1],
    type: definition[2],
    width: definition[3],
    letter: letters[definition[0]],
    formula: definition[4] === undefined ? null : resolveFormula(definition[4], letters),
  }));
}

function resolveFormula(expression: string, letters: Record<string, string>): string {
  return expression.replace(/\{([a-z_]+)\}/g, (_match, key: string) => {
    // The row is bound by the caller, not here - the same formula goes down every
    // data row.
    if (key === 'row') {
      return '{row}';
    }

    if (!(key in letters)) {
      throw InvalidInputError.unknownOption('column reference', key, Object.keys(letters));
    }

    return letters[key];
  });
}

/** The A1 column letter for a zero-based index: 0 is A, 25 is Z, 26 is AA. */
function columnLetter(index: number): string {
  let letter = '';

  for (let n = index; n >= 0; n = Math.trunc(n / 26) - 1) {
    letter = String.fromCharCode(65 + (n % 26)) + letter;
  }

  return letter;
}

/** One of the four payroll spreadsheets, as a column schema with worked rows. */
export function calculateSalaryTemplate(
  input: SalaryTemplateInput = {},
  rates?: RateRepository,
): SalaryTemplateResult {
  return new SalaryTemplateBuilder(rates).calculate(input);
}

/**
 * The name the single-tool package `@crmleaf/salary-templates` re-exports. The
 * arithmetic lives here once, so a rate change cannot land in the suite and miss
 * the standalone package.
 */
export const salaryTemplates = calculateSalaryTemplate;
