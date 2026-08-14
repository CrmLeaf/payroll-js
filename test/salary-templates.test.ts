import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '../src/errors.js';
import { Money } from '../src/money.js';
import { defaultRates } from '../src/rates/index.js';
import { calculateCtc } from '../src/calculators/ctc.js';
import {
  SalaryTemplateBuilder,
  SalaryTemplateResult,
  type TemplateRow,
  calculateSalaryTemplate,
  salaryTemplates as salaryTemplatesAlias,
} from '../src/calculators/salary-templates.js';

/**
 * The same cases as PayrollCore's SalaryTemplateBuilderTest, with the same inputs
 * and the same expected shapes.
 *
 * Pinned to FY 2025-26, the only window in which every table the composed CTC
 * breakdown touches has a version in force.
 */
const AS_OF = '2025-08-01';

/**
 * A tokenised Excel formula: cell references and bare numbers joined by the four
 * arithmetic operators, and nothing else. Anything a spreadsheet would reject - an
 * unresolved `{key}` placeholder, a stray brace, a missing row - fails to match.
 */
const A1_FORMULA = /^=(?:[A-Z]{1,2}[0-9]+|[0-9]+)(?:[+\-*/](?:[A-Z]{1,2}[0-9]+|[0-9]+))*$/;

const EVERY_TEMPLATE = ['structure', 'register', 'slip', 'master'];

function build(
  template: string,
  options: { employeeCount?: number; annualCtc?: number; state?: string } = {},
): SalaryTemplateResult {
  return calculateSalaryTemplate({
    template,
    employeeCount: options.employeeCount ?? 25,
    annualCtc: Money.fromRupees(options.annualCtc ?? 12_00_000),
    state: options.state ?? 'Karnataka',
    asOf: AS_OF,
  });
}

function rowFor(result: SalaryTemplateResult, key: string, value: string): TemplateRow {
  const found = result.rows.find((row) => row[key] === value);

  if (!found) {
    throw new Error(`No row where ${key} is "${value}".`);
  }

  return found;
}

const cash = (row: TemplateRow, key: string): Money => row[key] as Money;

describe('the four templates', () => {
  const cases: Array<[string, string, number, number, string[]]> = [
    ['structure', 'Salary structure', 5, 9, ['Component', 'Category', 'Monthly (₹)']],
    [
      'register',
      'Monthly salary register',
      17,
      25,
      ['Employee code', 'Employee name', 'Days paid'],
    ],
    ['slip', 'Salary slip', 7, 23, ['Section', 'Particular', 'This month (₹)']],
    ['master', 'Employee master', 13, 25, ['Employee code', 'Employee name', 'Date of joining']],
  ];

  for (const [template, title, columns, rows, headStart] of cases) {
    it(`gives ${template} its own columns and rows`, () => {
      const result = build(template, { employeeCount: 25 });

      expect(result.template).toBe(template);
      expect(result.title).toBe(title);
      expect(result.columnCount()).toBe(columns);
      expect(result.rowCount()).toBe(rows);
      expect(result.headers().slice(0, headStart.length)).toEqual(headStart);

      // Headers, keys and columns are three views of one ordered list; a consumer
      // zipping rows against headers depends on them staying aligned.
      expect(result.headers()).toHaveLength(columns);
      expect(result.keys()).toHaveLength(columns);
      expect(Object.keys(result.rows[0])).toEqual(result.keys());

      expect(result.explain()).not.toBe('');
      expect(result.citations).not.toEqual([]);
    });
  }

  /**
   * The register and the master are drawn up per employee; the structure and the
   * slip describe one employee however many are on the payroll.
   */
  const rowCounts: Array<[string, number, number]> = [
    ['register', 1, 1],
    ['register', 2, 2],
    ['register', 3, 3],
    ['register', 40, 40],
    ['master', 1, 1],
    ['master', 40, 40],
    ['structure', 1, 9],
    ['structure', 500, 9],
    ['slip', 1, 23],
    ['slip', 500, 23],
  ];

  for (const [template, employeeCount, expected] of rowCounts) {
    it(`follows the employee count only where it should: ${template} × ${employeeCount}`, () => {
      const result = build(template, { employeeCount });

      expect(result.rowCount()).toBe(expected);
      expect(result.employeeCount).toBe(employeeCount);
      expect(result.toArray().row_count).toBe(expected);
    });
  }

  it('publishes the template list for a caller building a picker', () => {
    expect(SalaryTemplateBuilder.templates()).toEqual(['structure', 'register', 'slip', 'master']);
  });
});

describe('validation', () => {
  for (const template of ['', 'payslip', 'registers', 'xlsx', '../../etc/passwd']) {
    it(`refuses the unknown template "${template}"`, () => {
      expect(() => calculateSalaryTemplate({ template, asOf: AS_OF })).toThrow(
        'Allowed: structure, register, slip, master.',
      );
    });
  }

  /**
   * A form posts what the user typed. Case and stray whitespace are not a caller
   * error, so they are normalised rather than rejected.
   */
  for (const template of ['REGISTER', '  register  ', 'Register\n']) {
    it(`trims and lowercases ${JSON.stringify(template)}`, () => {
      expect(
        calculateSalaryTemplate({ template, employeeCount: 4, asOf: AS_OF }).template,
      ).toBe('register');
    });
  }

  for (const [employeeCount, expected] of [
    [0, 'at least 1'],
    [-5, 'at least 1'],
    [5001, 'at most 5000 sample rows'],
  ] as Array<[number, string]>) {
    it(`bounds the employee count: ${employeeCount}`, () => {
      expect(() =>
        calculateSalaryTemplate({ template: 'register', employeeCount, asOf: AS_OF }),
      ).toThrow(expected);
    });
  }

  it('survives the inclusive upper bound', () => {
    expect(build('register', { employeeCount: 5000 }).rowCount()).toBe(5000);
  });

  it('refuses a negative cost to company', () => {
    expect(() =>
      calculateSalaryTemplate({ template: 'structure', annualCtc: -1, asOf: AS_OF }),
    ).toThrow('Annual CTC cannot be negative.');
  });

  it('refuses an unknown column rather than returning null', () => {
    expect(() => build('register').column('gross_pay')).toThrow('Unknown column "gross_pay"');
  });

  it('refuses to bind a formula to a row above the sheet', () => {
    expect(() => build('structure').formulaFor('annual', 0)).toThrow(
      'row must be a sheet row of 1 or more',
    );
  });
});

describe('the structure template', () => {
  /**
   * The property the structure template exists to demonstrate. Special allowance
   * is a balancing figure, so every component row - earnings and employer
   * contributions alike - must add back to the cost to company to the paise.
   */
  const cases: Array<[string, number, string]> = [
    ['the default package', 12_00_000, 'Karnataka'],
    ['below the ESI limit', 2_40_000, 'Karnataka'],
    ['a package that does not divide by twelve', 10_00_007, 'Maharashtra'],
    ['a senior package', 75_00_000, 'West Bengal'],
    ['a state that levies no monthly tax', 12_00_000, 'Tamil Nadu'],
    ['nil', 0, 'Karnataka'],
  ];

  for (const [name, annualCtc, state] of cases) {
    it(`sums the components back to the cost to company: ${name}`, () => {
      const result = build('structure', { annualCtc, state });

      let components = Money.zero();

      for (const row of result.rows) {
        expect(row.monthly).toBeInstanceOf(Money);

        if (row.category !== 'Total') {
          components = components.add(row.monthly as Money);
        }
      }

      const costToCompany = rowFor(result, 'component', 'Cost to company');

      expect(components.paise).toBe(cash(costToCompany, 'monthly').paise);

      // And the annual column is the monthly one times twelve, which is what the
      // =C{row}*12 formula will compute once the sheet is opened.
      expect(cash(costToCompany, 'annual').paise).toBe(
        cash(costToCompany, 'monthly').multiply(12).paise,
      );

      const gross = rowFor(result, 'component', 'Gross salary');
      const basic = rowFor(result, 'component', 'Basic');
      const hra = rowFor(result, 'component', 'House rent allowance');
      const special = rowFor(result, 'component', 'Special allowance');

      expect(
        cash(basic, 'monthly').add(cash(hra, 'monthly'), cash(special, 'monthly')).paise,
      ).toBe(cash(gross, 'monthly').paise);
    });
  }

  /**
   * The sample is not invented. Every figure on the structure template is the
   * figure the CTC calculator returns for the same package on the same date.
   */
  it('is the calculator’s own answer', () => {
    const annualCtc = Money.fromRupees(18_00_000);

    const template = calculateSalaryTemplate({
      template: 'structure',
      annualCtc,
      state: 'Karnataka',
      asOf: AS_OF,
    });

    const ctc = calculateCtc({ annualCtc, state: 'Karnataka', asOf: AS_OF });

    expect(cash(rowFor(template, 'component', 'Basic'), 'monthly').paise).toBe(ctc.basic.paise);
    expect(cash(rowFor(template, 'component', 'House rent allowance'), 'monthly').paise).toBe(
      ctc.hra.paise,
    );
    expect(cash(rowFor(template, 'component', 'Special allowance'), 'monthly').paise).toBe(
      ctc.specialAllowance.paise,
    );
    expect(cash(rowFor(template, 'component', 'Employer provident fund'), 'monthly').paise).toBe(
      ctc.employerPf.paise,
    );
    expect(cash(rowFor(template, 'component', 'Employer ESI'), 'monthly').paise).toBe(
      ctc.employerEsi.paise,
    );
    expect(cash(rowFor(template, 'component', 'Gratuity provision'), 'monthly').paise).toBe(
      ctc.gratuityProvision.paise,
    );
  });
});

describe('the register template', () => {
  /**
   * The sample register has to exercise the ESI columns both ways whatever
   * reference CTC it is drawn up at.
   */
  for (const annualCtc of [12_00_000, 1_80_000, 2_76_000, 1_20_00_000]) {
    it(`crosses the ESI wage limit in both directions at ₹${annualCtc}`, () => {
      const result = build('register', { employeeCount: 12, annualCtc });
      const wageLimit = defaultRates.for('esi', AS_OF).money('wage_limit');

      let covered = 0;
      let uncovered = 0;

      for (const row of result.rows) {
        const gross = cash(row, 'gross_earnings');

        if (gross.lessThanOrEqual(wageLimit)) {
          covered += 1;

          // 0.75% of gross, rounded up to the whole rupee under rule 51.
          expect(cash(row, 'employee_esi').paise).toBe(
            gross.percentage(0.75).roundUpToRupee().paise,
          );
          expect(cash(row, 'employer_esi').isPositive()).toBe(true);

          continue;
        }

        uncovered += 1;

        expect(cash(row, 'employee_esi').paise).toBe(0);
        expect(cash(row, 'employer_esi').paise).toBe(0);
      }

      expect(covered).toBeGreaterThan(0);
      expect(uncovered).toBeGreaterThan(0);
    });
  }

  /**
   * Each register row has to satisfy the arithmetic its own formula columns will
   * perform once the workbook opens. If the sample and the formula disagree, the
   * sheet changes its numbers the moment somebody recalculates.
   */
  it('agrees with its own formulae', () => {
    const result = build('register', { employeeCount: 15, annualCtc: 9_60_000 });

    for (const row of result.rows) {
      expect(
        cash(row, 'basic').add(cash(row, 'hra'), cash(row, 'special_allowance')).paise,
      ).toBe(cash(row, 'gross_earnings').paise);

      expect(
        cash(row, 'employee_pf').add(
          cash(row, 'employee_esi'),
          cash(row, 'professional_tax'),
          cash(row, 'tds'),
        ).paise,
      ).toBe(cash(row, 'total_deductions').paise);

      expect(cash(row, 'gross_earnings').subtract(cash(row, 'total_deductions')).paise).toBe(
        cash(row, 'net_pay').paise,
      );

      expect(
        cash(row, 'gross_earnings').add(
          cash(row, 'employer_pf'),
          cash(row, 'employer_esi'),
          cash(row, 'gratuity_provision'),
        ).paise,
      ).toBe(cash(row, 'cost_to_company').paise);
    }
  });

  /**
   * Repeated packages are computed once and reused, so the memo has to be scoped
   * to the call. A register drawn up for Karnataka and then for Bihar must not
   * hand back Karnataka's professional tax.
   */
  it('recomputes the sample per state rather than caching it', () => {
    const karnataka = build('register', { employeeCount: 6, state: 'Karnataka' });
    const bihar = build('register', { employeeCount: 6, state: 'Bihar' });

    expect(karnataka.state).toBe('Karnataka');
    expect(bihar.state).toBe('Bihar');
    expect(cash(karnataka.rows[0], 'professional_tax').paise).not.toBe(
      cash(bihar.rows[0], 'professional_tax').paise,
    );
  });

  /**
   * The register's rows are the master's rows: the same people, the same codes,
   * the same packages.
   */
  it('describes the same people as the master', () => {
    const register = build('register', { employeeCount: 9 });
    const master = build('master', { employeeCount: 9 });

    expect(master.rows.map((row) => row.employee_code)).toEqual(
      register.rows.map((row) => row.employee_code),
    );
    expect(master.rows.map((row) => row.employee_name)).toEqual(
      register.rows.map((row) => row.employee_name),
    );

    master.rows.forEach((row, index) => {
      expect(cash(row, 'annual_ctc').divide(12).paise).toBe(
        cash(register.rows[index], 'cost_to_company').paise,
      );
    });
  });

  it('takes the statutory version from the asOf date', () => {
    const wageLimit = defaultRates.for('esi', AS_OF).money('wage_limit');
    const row = build('register', { employeeCount: 4, annualCtc: 2_40_000 }).rows[0];
    const gross = cash(row, 'gross_earnings');

    expect(gross.lessThanOrEqual(wageLimit)).toBe(true);
    expect(cash(row, 'employee_esi').paise).toBe(gross.percentage(0.75).roundUpToRupee().paise);
    expect(cash(row, 'employer_esi').paise).toBe(gross.percentage(3.25).roundUpToRupee().paise);
  });
});

describe('the slip template', () => {
  /**
   * Section 192 runs on the financial year, so a slip's year-to-date column counts
   * from April rather than from January.
   */
  for (const [asOf, months] of [
    ['2025-04-15', 1],
    ['2025-08-01', 5],
    ['2026-03-10', 12],
  ] as Array<[string, number]>) {
    it(`counts ${months} month(s) of the year to date on ${asOf}`, () => {
      const result = calculateSalaryTemplate({ template: 'slip', asOf });
      const basic = rowFor(result, 'particular', 'Basic');

      expect(cash(basic, 'year_to_date').paise).toBe(
        cash(basic, 'current_month').multiply(months).paise,
      );
    });
  }

  it('carries the particulars a wage slip must show', () => {
    const result = build('slip');
    const particulars = result.rows.map((row) => row.particular);

    for (const required of [
      'Employee name',
      'Date of joining',
      'Wage period',
      'Days paid',
      'Loss of pay days',
      'Basic',
      'Gross earnings',
      'Total deductions',
      'Net pay',
    ]) {
      expect(particulars).toContain(required);
    }

    const gross = rowFor(result, 'particular', 'Gross earnings');
    const deductions = rowFor(result, 'particular', 'Total deductions');
    const net = rowFor(result, 'particular', 'Net pay');

    expect(
      cash(gross, 'current_month').subtract(cash(deductions, 'current_month')).paise,
    ).toBe(cash(net, 'current_month').paise);

    expect(result.citations.join(' ')).toContain('section 13A');
  });
});

describe('the master template', () => {
  /**
   * A template gets filled in by copying the example row, so an example carrying a
   * well-formed PAN or a twelve-digit UAN is somebody's PAN or UAN waiting to be
   * filed in a return.
   */
  const identifiers: Array<[string, string, RegExp]> = [
    // Five letters, four digits, a letter.
    ['PAN', 'pan', /^[A-Za-z]{5}[0-9]{4}[A-Za-z]$/],
    // Twelve digits.
    ['UAN', 'uan', /^[0-9]{12}$/],
    // Ten digits.
    ['ESIC insurance number', 'esic_number', /^[0-9]{10}$/],
    // Nine to eighteen digits.
    ['bank account', 'bank_account_number', /^[0-9]{9,18}$/],
    // Four letters, a zero, six alphanumerics.
    ['IFSC', 'ifsc', /^[A-Za-z]{4}0[A-Za-z0-9]{6}$/],
  ];

  for (const [name, column, realPattern] of identifiers) {
    it(`could not mistake a sample ${name} for a real one`, () => {
      for (const row of build('master', { employeeCount: 60 }).rows) {
        const value = row[column];

        expect(typeof value).toBe('string');
        expect(value as string).not.toMatch(realPattern);
        expect(value as string).toContain('SAMPLE');
      }
    });
  }

  it('carries the columns the monthly filings are keyed on', () => {
    const result = build('master');

    for (const key of [
      'employee_code',
      'employee_name',
      'date_of_joining',
      'pan',
      'uan',
      'esic_number',
      'bank_name',
      'bank_account_number',
      'ifsc',
      'department',
      'designation',
      'annual_ctc',
    ]) {
      expect(result.keys()).toContain(key);
    }

    expect(result.column('date_of_joining').type).toBe('date');
    expect(result.column('annual_ctc').type).toBe('money');

    const row = (result.toArray().rows as Array<Record<string, unknown>>)[0];

    expect(row.date_of_joining).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof row.annual_ctc).toBe('number');
  });
});

describe('the formulae between the columns', () => {
  /**
   * A formula column has to emit something a spreadsheet will accept: real A1
   * references, pointing at columns that exist in this template, on the row it was
   * asked for. An unresolved `{key}` placeholder is the failure this catches.
   */
  for (const template of EVERY_TEMPLATE) {
    it(`emits valid A1 references on ${template}`, () => {
      const result = build(template, { employeeCount: 30 });
      const letters = result.columns.map((column) => column.letter);
      let formulaColumns = 0;

      for (const column of result.columns) {
        if (column.type !== 'formula') {
          expect(column.formula).toBeNull();
          expect(result.formulaFor(column.key, 2)).toBeNull();

          continue;
        }

        formulaColumns += 1;

        expect(column.formula).toContain('{row}');

        for (const row of [result.firstDataRow(), result.lastDataRow(), 7]) {
          const formula = result.formulaFor(column.key, row)!;

          expect(formula).toMatch(A1_FORMULA);
          expect(formula).not.toContain('{');

          const references = [...formula.matchAll(/([A-Z]{1,2})([0-9]+)/g)];
          expect(references.length).toBeGreaterThan(0);

          for (const reference of references) {
            expect(letters).toContain(reference[1]);
            expect(Number(reference[2])).toBe(row);
          }

          // A formula must never point at itself: the column it is on cannot be
          // one of its own inputs.
          expect(references.map((reference) => reference[1])).not.toContain(column.letter);
        }
      }

      expect(formulaColumns).toBeGreaterThan(0);
      expect(Object.keys(result.formulas(result.firstDataRow()))).toHaveLength(formulaColumns);
    });
  }

  it('runs the column letters in sheet order', () => {
    const result = build('register');

    expect(result.letterFor('employee_code')).toBe('A');
    expect(result.letterFor('gross_earnings')).toBe('G');
    expect(result.letterFor('cost_to_company')).toBe('Q');

    // The net pay formula is written against column keys and only becomes A1
    // here, so this is the assertion that catches a reordered column.
    expect(result.formulaFor('net_pay', 2)).toBe('=G2-L2');
    expect(result.formulaFor('net_pay', 51)).toBe('=G51-L51');
  });

  it('puts the data range below the header row', () => {
    const result = build('register', { employeeCount: 40 });

    expect(SalaryTemplateResult.HEADER_ROW).toBe(1);
    expect(result.firstDataRow()).toBe(2);
    expect(result.lastDataRow()).toBe(41);
    expect(result.lastDataRow() - result.firstDataRow() + 1).toBe(result.rowCount());
  });
});

describe('the wire shape', () => {
  for (const template of EVERY_TEMPLATE) {
    it(`is snake_case with money as rupees and a formatted twin: ${template}`, () => {
      const result = build(template, { employeeCount: 6, annualCtc: 12_00_000 });
      const array = result.toArray() as Record<string, never>;

      expect(array.template).toBe(template);
      expect(array.annual_ctc).toBe(12_00_000);
      expect(array.annual_ctc_formatted).toBe('₹12,00,000.00');
      expect(array.column_count).toBe(result.columnCount());
      expect(array.row_count).toBe(result.rowCount());
      expect(array.headers).toEqual(result.headers());
      expect(array.notes).not.toEqual([]);

      for (const column of array.columns as unknown as Array<Record<string, unknown>>) {
        expect(column).toHaveProperty('formula_first_row');
        expect(['text', 'money', 'number', 'date', 'formula']).toContain(column.type);
        expect(column.width as number).toBeGreaterThan(0);
      }

      const rows = array.rows as unknown as Array<Record<string, unknown>>;

      for (const column of result.columns) {
        if (column.type !== 'money') {
          continue;
        }

        rows.forEach((row, index) => {
          const native = result.rows[index][column.key];

          // The slip's employee and attendance rows have no money in the money
          // columns, and an empty cell stays empty rather than becoming a zero
          // somebody might add up.
          if (native === null) {
            expect(row[column.key]).toBeNull();
            expect(row).not.toHaveProperty(`${column.key}_formatted`);

            return;
          }

          const money = native as Money;
          expect(row[column.key]).toBe(money.toRupees());
          expect(row[`${column.key}_formatted`]).toBe(money.format());
        });
      }

      // toJSON() adds the explanation, the working and the citations on top of
      // toArray(), which is what an HTTP layer answers with.
      const json = result.toJSON();

      expect(json.template).toBe(array.template);
      expect(json.steps).not.toEqual([]);
      expect(json.explanation).not.toBe('');
    });
  }

  for (const template of EVERY_TEMPLATE) {
    it(`cites its statutes: ${template}`, () => {
      const result = build(template, { employeeCount: 5 });

      expect(result.workings).not.toEqual([]);
      expect(result.citations).not.toEqual([]);
      expect([...new Set(result.citations)]).toEqual([...result.citations]);

      for (const citation of result.citations) {
        expect(citation.trim()).not.toBe('');
      }

      expect(result.workingsText()).not.toBe('');
    });
  }

  it('is reachable under the name the single-tool package re-exports', () => {
    expect(salaryTemplatesAlias).toBe(calculateSalaryTemplate);
  });
});
