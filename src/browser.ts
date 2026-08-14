/**
 * The `<script src="…/payroll.min.js">` entry point.
 *
 * Everything the module build exports is here under the global `Payroll`, and the
 * custom elements register and mount themselves the moment the file loads. A
 * plain HTML page needs no other line of JavaScript.
 */

import { autoBoot } from './ui/elements.js';

autoBoot();

export * from './index.js';
