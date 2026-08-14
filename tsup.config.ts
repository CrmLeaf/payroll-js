import { defineConfig } from 'tsup';

/**
 * Two of the three consumption modes are built here.
 *
 * Mode A - the bundler entries: ESM and CJS with declarations, one file per
 * calculator so `@crmleaf/payroll-js/gratuity` pulls in the gratuity maths and
 * nothing else, and `sideEffects: false` in package.json lets a bundler drop what
 * a page never calls.
 *
 * Mode B - the browser bundle - is built by scripts/build-umd.mjs, because it has
 * to be a single self-contained IIFE with a global rather than a module graph.
 */
export default defineConfig({
  entry: [
    'src/index.ts',
    'src/browser.ts',
    'src/money.ts',
    'src/result.ts',
    'src/errors.ts',
    'src/dates.ts',
    'src/rates/index.ts',
    'src/ui/elements.ts',
    'src/ui/tools.ts',
    'src/ui/styles.ts',
    'src/calculators/ctc.ts',
    'src/calculators/tds.ts',
    'src/calculators/pf.ts',
    'src/calculators/esi.ts',
    'src/calculators/gratuity.ts',
    'src/calculators/bonus.ts',
    'src/calculators/leave-encashment.ts',
    'src/calculators/fnf.ts',
    'src/calculators/epfo-penalty.ts',
    'src/calculators/compliance-calendar.ts',
    'src/calculators/roi.ts',
    'src/calculators/savings.ts',
    'src/calculators/income-tax.ts',
    'src/calculators/professional-tax.ts',
    'src/calculators/payslip.ts',
    'src/calculators/invoice.ts',
    'src/calculators/salary-templates.ts',
  ],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  splitting: true,
  clean: true,
  treeshake: true,
  outExtension({ format }) {
    return { js: format === 'cjs' ? '.cjs' : '.js' };
  },
});
