// @vitest-environment node

/**
 * The package must import cleanly where there is no DOM.
 *
 * Every other test file runs under happy-dom, which defines `HTMLElement`
 * globally - so a module-scope `class extends HTMLElement` passed the entire
 * suite while making `import '@crmleaf/payroll-js'` throw `ReferenceError` for
 * anyone rendering on a server, running a Node test runner, or importing the
 * calculators from a build script. The arithmetic in this package has nothing to
 * do with the browser, so requiring one to load it was never defensible.
 *
 * This file runs with the node environment precisely so it would catch that
 * again.
 */

import { describe, expect, it } from 'vitest';

describe('importing the package without a DOM', () => {
  it('has no DOM globals in this environment', () => {
    // Guards the guard: if happy-dom leaked in here, the rest proves nothing.
    expect(typeof globalThis.HTMLElement).toBe('undefined');
    expect(typeof globalThis.document).toBe('undefined');
  });

  it('loads the root entry and computes', async () => {
    const payroll = await import('../src/index.js');

    expect(typeof payroll.gratuity).toBe('function');

    const result = payroll.gratuity({
      lastDrawnSalary: 45_000,
      yearsOfService: 7,
      monthsOfService: 8,
    });

    // (15 × 45000 × 8) ÷ 26, the same figure the PHP suite pins.
    expect(result.gratuity.toRupees()).toBeCloseTo(207_692.31, 2);
  });

  it('exposes every documented short alias', async () => {
    const payroll = await import('../src/index.js');

    for (const name of [
      'ctc',
      'tds',
      'pf',
      'esi',
      'gratuity',
      'bonus',
      'leaveEncashment',
      'fnf',
      'epfoPenalty',
      'complianceCalendar',
      'roi',
      'savings',
      'payslip',
      'invoice',
      'salaryTemplates',
    ]) {
      expect(typeof (payroll as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('exposes the element helpers but registers nothing without a registry', async () => {
    const { definePayrollElements } = await import('../src/index.js');

    expect(typeof definePayrollElements).toBe('function');
    // No customElements registry outside a browser, so this is a no-op rather
    // than a crash.
    expect(() => definePayrollElements()).not.toThrow();
  });
});
