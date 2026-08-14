// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// A DOM environment gives `import.meta.url` an http scheme, so paths come off the
// project root instead. Vitest runs with the package directory as its cwd.
const bundlePath = resolve(process.cwd(), 'dist/payroll.min.js');
const examplePath = resolve(process.cwd(), 'examples/embed.html');

/**
 * Mode B, exercised the way a static page uses it: load the one built file into a
 * document and check that a global appears, the elements register themselves, and
 * a widget renders - with no import, no bundler and no other line of JavaScript.
 *
 * Skipped when dist is absent so `npm test` works on a fresh clone; CI runs the
 * build first, and `npm run build && npm test` is the contract.
 */
const describeBundle = existsSync(bundlePath) ? describe : describe.skip;

describeBundle('the single-file browser bundle', () => {
  function loadBundle(): Record<string, unknown> {
    const source = readFileSync(bundlePath, 'utf8');
    const script = document.createElement('script');
    script.textContent = source;
    document.head.append(script);

    const global = (globalThis as Record<string, unknown>).Payroll;
    if (!global) throw new Error('the bundle did not expose a Payroll global');

    return global as Record<string, unknown>;
  }

  it('exposes the calculators on a global', () => {
    const Payroll = loadBundle();

    expect(typeof Payroll.calculateGratuity).toBe('function');
    expect(typeof Payroll.calculatePf).toBe('function');
    expect(typeof Payroll.Money).toBe('function');
    expect(typeof Payroll.mountPayrollTools).toBe('function');
  });

  it('computes the same figures as the module build', () => {
    const Payroll = loadBundle() as {
      calculateGratuity: (input: unknown) => { gratuity: { format(): string } };
    };

    const result = Payroll.calculateGratuity({
      lastDrawnSalary: 45000,
      yearsOfService: 7,
      monthsOfService: 7,
      asOf: '2025-06-01',
    });

    expect(result.gratuity.format()).toBe('₹2,07,692.31');
  });

  it('registers the custom elements on load', () => {
    loadBundle();

    expect(customElements.get('payroll-gratuity-calculator')).toBeTypeOf('function');
    expect(customElements.get('payroll-compliance-calendar')).toBeTypeOf('function');
  });

  it('carries no external dependency', () => {
    const source = readFileSync(bundlePath, 'utf8');

    expect(source).not.toMatch(/\brequire\s*\(/);
    expect(source).not.toMatch(/\bfrom\s*["']https?:/);
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
});

describe('examples/embed.html', () => {
  const html = readFileSync(examplePath, 'utf8');

  it('is a real, self-contained page', () => {
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain('<payroll-gratuity-calculator');
    expect(html).toContain('data-payroll=');
  });

  it('points at a script that the build actually produces', () => {
    const sources = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((match) => match[1]);

    expect(sources.length).toBeGreaterThan(0);

    for (const src of sources) {
      if (src.startsWith('http')) {
        expect(src).toContain('@crmleaf/payroll-js');
        continue;
      }
      expect(src).toBe('../dist/payroll.min.js');
    }
  });

  it('names only tools that exist', () => {
    const tags = [...html.matchAll(/<(payroll-[a-z-]+)/g)].map((match) => match[1]);
    const attrs = [...html.matchAll(/data-payroll="([^"]+)"/g)].map((match) => match[1]);

    for (const name of [...new Set([...tags, ...attrs])]) {
      expect(customElements.get(name) ?? name, `unknown tool ${name}`).toBeTruthy();
    }
  });
});
