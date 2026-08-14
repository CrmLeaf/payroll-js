#!/usr/bin/env node
/**
 * Builds mode B: the single file a plain HTML page drops in with a <script> tag.
 *
 * One IIFE, no imports, no dependencies, the rate tables baked in, exposing a
 * global `Payroll` and registering the custom elements on load. Two artefacts -
 * a readable one for debugging and a minified one for production - because
 * "view source and understand it" is a reasonable thing to want from a widget
 * you have put on your own marketing site.
 */

import { build } from 'esbuild';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const shared = {
  entryPoints: [resolve(packageRoot, 'src/browser.ts')],
  bundle: true,
  format: 'iife',
  globalName: 'Payroll',
  platform: 'browser',
  target: ['es2020', 'chrome90', 'firefox90', 'safari15', 'edge90'],
  legalComments: 'none',
  banner: {
    js: '/*! @crmleaf/payroll-js - Indian payroll calculators that show their working. MIT licensed. */',
  },
  // esbuild emits an IIFE that assigns the module namespace to `var Payroll`,
  // which is the global on a page. The footer adds the other half of UMD so the
  // same file also works when something has already set up a CommonJS-style
  // loader - a surprising number of CMS plugin sandboxes have.
  footer: {
    js: [
      // `var Payroll = …` only reaches the global when the script is evaluated at
      // document scope. Assigning explicitly means the file also works from inside
      // a module script, a bundler's eval, or a CMS sandbox that wraps it.
      'if (typeof globalThis !== "undefined") { globalThis.Payroll = Payroll; }',
      // The other half of UMD, for the loaders that define `module`.
      'if (typeof module === "object" && module !== null && module.exports) { module.exports = Payroll; }',
    ].join('\n'),
  },
};

for (const [outfile, minify] of [
  ['dist/payroll.js', false],
  ['dist/payroll.min.js', true],
]) {
  await build({ ...shared, outfile: resolve(packageRoot, outfile), minify, sourcemap: !minify });
  const { size } = statSync(resolve(packageRoot, outfile));
  console.log(`${outfile.padEnd(24)} ${(size / 1024).toFixed(1)} kB`);
}
