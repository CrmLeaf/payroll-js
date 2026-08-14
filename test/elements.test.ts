// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { definePayrollElements, mountPayrollTools } from '../src/ui/elements.js';
import { TOOLS, findTool } from '../src/ui/tools.js';

definePayrollElements();

function shadow(host: Element): ShadowRoot {
  const root = host.shadowRoot;
  if (!root) throw new Error('element has no shadow root');
  return root;
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe('the embeddable widgets', () => {
  it('registers an element per tool', () => {
    for (const tool of TOOLS) {
      expect(customElements.get(tool.element)).toBeTypeOf('function');
    }
    expect(customElements.get('payroll-tool')).toBeTypeOf('function');
  });

  it('renders a working calculator from a bare tag', () => {
    document.body.innerHTML = '<payroll-gratuity-calculator></payroll-gratuity-calculator>';
    const host = document.querySelector('payroll-gratuity-calculator')!;
    const root = shadow(host);

    expect(root.querySelector('.title')?.textContent).toBe('Gratuity Calculator');
    // 15 × 45,000 × 8 ÷ 26 on the defaults.
    expect(root.querySelector('.headline-value')?.textContent).toBe('₹2,07,692.31');
  });

  it('keeps the host page out: everything lives in a shadow root', () => {
    document.body.innerHTML = '<payroll-pf-calculator></payroll-pf-calculator>';
    const host = document.querySelector('payroll-pf-calculator')!;

    expect(host.shadowRoot).not.toBeNull();
    expect(host.children).toHaveLength(0);
    expect(shadow(host).querySelector('style')?.textContent).toContain('--payroll-accent');
  });

  it('mounts a data-attribute placeholder', () => {
    document.body.innerHTML = '<div data-payroll="pf-calculator" basic-salary="10000"></div>';

    expect(mountPayrollTools()).toBe(1);

    const widget = document.querySelector('payroll-pf-calculator')!;
    // ₹1,200 employee + ₹1,200 employer + ₹50 EDLI on PF wages of ₹10,000.
    expect(shadow(widget).querySelector('.headline-value')?.textContent).toBe('₹2,450.00');
  });

  it('does not mount the same placeholder twice', () => {
    document.body.innerHTML = '<div data-payroll="esi-calculator"></div>';

    expect(mountPayrollTools()).toBe(1);
    expect(mountPayrollTools()).toBe(0);
  });

  it('takes its starting values from attributes', () => {
    document.body.innerHTML =
      '<payroll-gratuity-calculator last-drawn-salary="60000" years-of-service="10"></payroll-gratuity-calculator>';
    const root = shadow(document.querySelector('payroll-gratuity-calculator')!);

    // 15 × 60,000 × 10 ÷ 26.
    expect(root.querySelector('.headline-value')?.textContent).toBe('₹3,46,153.85');
  });

  it('recalculates as the inputs change', () => {
    document.body.innerHTML = '<payroll-pf-calculator></payroll-pf-calculator>';
    const host = document.querySelector('payroll-pf-calculator')!;
    const root = shadow(host);

    // The default ₹30,000 basic is restricted to the ₹15,000 ceiling.
    expect(root.querySelector('.headline-value')?.textContent).toBe('₹3,675.00');

    const input = root.querySelector<HTMLInputElement>('input[name="basicSalary"]')!;
    input.value = '10000';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.querySelector('.headline-value')?.textContent).toBe('₹2,450.00');
  });

  it('emits the result for a host page to hook into', () => {
    document.body.innerHTML = '<payroll-esi-calculator></payroll-esi-calculator>';
    const host = document.querySelector('payroll-esi-calculator')!;

    let seen: string | null = null;
    host.addEventListener('payroll:result', (event) => {
      seen = (event as CustomEvent).detail.result.headline.value;
    });

    (host as HTMLElement & { run(): void }).run();

    expect(seen).toBe('₹720.00');
  });

  it('reports a bad input in the widget instead of throwing', () => {
    document.body.innerHTML = '<payroll-gratuity-calculator></payroll-gratuity-calculator>';
    const root = shadow(document.querySelector('payroll-gratuity-calculator')!);

    const months = root.querySelector<HTMLInputElement>('input[name="monthsOfService"]')!;
    months.value = '20';
    months.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.querySelector('.note.error')?.textContent).toContain('between 0 and 11');
  });

  it('says so plainly when the tool name is unknown', () => {
    document.body.innerHTML = '<payroll-tool tool="not-a-tool"></payroll-tool>';
    const root = shadow(document.querySelector('payroll-tool')!);

    expect(root.querySelector('.note.error')?.textContent).toContain('Unknown payroll tool');
  });

  it('is accessible: labels are tied to controls and results are announced', () => {
    document.body.innerHTML = '<payroll-gratuity-calculator></payroll-gratuity-calculator>';
    const root = shadow(document.querySelector('payroll-gratuity-calculator')!);

    for (const label of Array.from(root.querySelectorAll('label'))) {
      const id = label.getAttribute('for');
      expect(id, `label "${label.textContent}" has no for=`).toBeTruthy();
      expect(root.querySelector(`#${id}`), `nothing with id ${id}`).not.toBeNull();
    }

    const output = root.querySelector('.result')!;
    expect(output.getAttribute('aria-live')).toBe('polite');
    expect(output.getAttribute('role')).toBe('status');

    // Hints are wired up rather than merely displayed.
    const hinted = root.querySelector('[aria-describedby]');
    expect(hinted).not.toBeNull();
    expect(root.querySelector(`#${hinted!.getAttribute('aria-describedby')}`)).not.toBeNull();
  });

  it('makes the tax year a control, so the widgets outlive the Finance Act', () => {
    // A Finance Act covers one year, so the income-tax table has a closed end
    // date. Defaulting these two to "today" would make them start refusing to
    // compute the morning after 31 March; the year is a field instead.
    for (const tag of ['payroll-tds-calculator', 'payroll-ctc-calculator']) {
      document.body.innerHTML = `<${tag}></${tag}>`;
      const root = shadow(document.querySelector(tag)!);

      const years = root.querySelector<HTMLSelectElement>('select[name="financialYear"]');
      expect(years, `${tag} has no financial-year control`).not.toBeNull();
      expect(years!.options.length).toBeGreaterThan(1);

      expect(root.querySelector('.note.error')).toBeNull();
      expect(root.querySelector('.headline-value')?.textContent).toMatch(/^₹/);
    }
  });

  it('recomputes on an earlier financial year', () => {
    document.body.innerHTML = '<payroll-tds-calculator monthly-gross="106250"></payroll-tds-calculator>';
    const root = shadow(document.querySelector('payroll-tds-calculator')!);

    // FY 2025-26 rebates ₹12,00,000 of taxable income away entirely; FY 2024-25
    // did not, so switching the year has to move the number.
    expect(root.querySelector('.headline-value')?.textContent).toBe('₹0.00');

    const years = root.querySelector<HTMLSelectElement>('select[name="financialYear"]')!;
    years.value = '2024-25';
    years.dispatchEvent(new Event('change', { bubbles: true }));

    expect(root.querySelector('.headline-value')?.textContent).not.toBe('₹0.00');
    expect(root.querySelector('.note')?.textContent).toContain('FY 2024-25');
  });

  it('shows the working, with citations, behind a disclosure', () => {
    document.body.innerHTML = '<payroll-gratuity-calculator></payroll-gratuity-calculator>';
    const root = shadow(document.querySelector('payroll-gratuity-calculator')!);

    const details = root.querySelector('details')!;
    expect(details.querySelectorAll('ol > li').length).toBeGreaterThan(2);
    expect(details.querySelector('.citations')?.textContent).toContain('Payment of Gratuity Act');
  });

  it('renders the calendar as dated events rather than a money table', () => {
    document.body.innerHTML = '<payroll-compliance-calendar></payroll-compliance-calendar>';
    const root = shadow(document.querySelector('payroll-compliance-calendar')!);

    expect(root.querySelectorAll('.event').length).toBeGreaterThan(50);
    expect(root.querySelector('table')).toBeNull();
  });

  it('renders a GST invoice, and moves the tax head with the place of supply', () => {
    document.body.innerHTML = '<payroll-invoice-generator></payroll-invoice-generator>';
    const root = shadow(document.querySelector('payroll-invoice-generator')!);

    // ₹50,000 at 18%, Karnataka to Karnataka, so 9% each to the centre and the
    // state and ₹59,000 payable.
    expect(root.querySelector('.headline-value')?.textContent).toBe('₹59,000.00');

    const labels = Array.from(root.querySelectorAll('tbody th')).map((cell) => cell.textContent);
    expect(labels).toContain('CGST');
    expect(labels).toContain('SGST');
    expect(labels).not.toContain('IGST');

    const place = root.querySelector<HTMLSelectElement>('select[name="buyerState"]')!;
    place.value = 'Maharashtra';
    place.dispatchEvent(new Event('change', { bubbles: true }));

    const afterwards = Array.from(root.querySelectorAll('tbody th')).map((cell) => cell.textContent);
    expect(afterwards).toContain('IGST');
    expect(afterwards).not.toContain('CGST');
    // The same total tax, under a different head.
    expect(root.querySelector('.headline-value')?.textContent).toBe('₹59,000.00');
  });

  it('renders a payslip prorated on the wage month it was given', () => {
    document.body.innerHTML =
      '<payroll-payslip-generator pay-month="2026-02-01" days-payable="28" lop-days="2">' +
      '</payroll-payslip-generator>';
    const root = shadow(document.querySelector('payroll-payslip-generator')!);

    expect(root.querySelector('.note.error')).toBeNull();
    // (75,000 × 26) ÷ 28 less PF and Karnataka professional tax.
    expect(root.querySelector('.headline-value')?.textContent).toBe('₹67,642.86');
  });

  it('renders a salary template as a column schema rather than a sum', () => {
    document.body.innerHTML = '<payroll-salary-templates></payroll-salary-templates>';
    const root = shadow(document.querySelector('payroll-salary-templates')!);

    expect(root.querySelector('.note.error')).toBeNull();
    expect(root.querySelector('.headline-value')?.textContent).toBe('5 × 9');

    const rows = Array.from(root.querySelectorAll('tbody td')).map((cell) => cell.textContent);
    expect(rows).toContain('=C2*12');
  });

  it('resolves the short form of a tool name', () => {
    expect(findTool('gratuity')?.slug).toBe('gratuity-calculator');
    expect(findTool('pf-calculator')?.slug).toBe('pf-calculator');
    expect(findTool('payroll-esi-calculator')?.slug).toBe('esi-calculator');
    expect(findTool('nope')).toBeUndefined();
  });

  it('never injects a value as markup', () => {
    document.body.innerHTML = '<payroll-tool tool="&lt;img src=x onerror=alert(1)&gt;"></payroll-tool>';
    const root = shadow(document.querySelector('payroll-tool')!);

    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.note.error')?.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});
