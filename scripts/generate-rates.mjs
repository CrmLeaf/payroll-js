#!/usr/bin/env node
/**
 * Copies the statutory rate tables out of the PHP package and into a TypeScript
 * module.
 *
 * The numbers live in exactly one place - packages/payroll-core/resources/rates
 * - and this script is the only way they reach the JavaScript build. Nothing is
 * retyped, reformatted or "tidied up": the JSON is embedded verbatim so that
 * bin/check-rate-parity.php can compare the two byte for byte and fail CI the
 * moment they drift.
 *
 * Run it with `npm run rates:generate`. It is also wired into `npm run build`,
 * so a stale generated file cannot be published by accident.
 *
 * Outside the monorepo - a split package repository, or an npm tarball - there
 * is no payroll-core to read, and there does not need to be: src/rates/tables.ts
 * is committed precisely so that JavaScript consumers need no PHP. In that case
 * this script keeps the committed file and exits successfully, because failing
 * would take `npm run build` (and with it `prepublishOnly`) down with it.
 *
 * The distinction is deliberate. A missing payroll-core means "not the
 * monorepo"; a payroll-core that is present but has no rates directory means
 * something is actually broken, and that still fails loudly.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');
const corePackage = resolve(packageRoot, '..', 'payroll-core');
const ratesDir = resolve(corePackage, 'resources', 'rates');
const outFile = resolve(packageRoot, 'src', 'rates', 'tables.ts');

if (!existsSync(corePackage)) {
  if (!existsSync(outFile)) {
    console.error(`Neither payroll-core nor a committed ${outFile} is present.`);
    console.error('One of the two has to exist: there is nowhere else to get the rates from.');
    process.exit(1);
  }

  console.log('payroll-core is not alongside this package, so this is not the monorepo.');
  console.log(`Keeping the committed ${outFile}.`);
  process.exit(0);
}

if (!existsSync(ratesDir)) {
  console.error(`payroll-core is present at ${corePackage} but ${ratesDir} is missing.`);
  console.error('The rate tables have moved or the checkout is incomplete.');
  process.exit(1);
}

const files = readdirSync(ratesDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error(`No rate tables found in ${ratesDir}`);
  process.exit(1);
}

const tables = {};
const digest = createHash('sha256');

for (const file of files) {
  const raw = readFileSync(join(ratesDir, file), 'utf8');
  const key = file.replace(/\.json$/, '');

  digest.update(`${key}\n`);
  digest.update(raw);

  tables[key] = JSON.parse(raw);
}

const checksum = digest.digest('hex');

const body = `/* eslint-disable */
// prettier-ignore
/**
 * The statutory rate tables, embedded so the browser build carries its own data
 * and needs no PHP at runtime.
 *
 * Every amount below is in PAISE, exactly as the PHP package stores it. The
 * checksum is verified against the PHP tables on every build, so the two cannot
 * drift apart unnoticed.
 *
 * Tables:  ${files.map((f) => f.replace(/\.json$/, '')).join(', ')}
 * SHA-256: ${checksum}
 *
 * The checksum is sha256 over, for each table key in ascending order, the key
 * followed by a newline followed by the raw bytes of its JSON file. Reproduce it
 * in PHP with:
 *
 *   \$digest = hash_init('sha256');
 *   foreach (\$sortedKeys as \$key) {
 *       hash_update(\$digest, \$key."\\n");
 *       hash_update(\$digest, file_get_contents(\$dir.'/'.\$key.'.json'));
 *   }
 *   hash_final(\$digest);
 */

export const RATES_CHECKSUM = ${JSON.stringify(checksum)};

export const RATE_TABLE_KEYS = ${JSON.stringify(Object.keys(tables))} as const;

export const RATE_TABLES: Record<string, RateTableDocument> = ${JSON.stringify(tables, null, 2)};

export interface RateTableVersion {
  effective_from: string;
  effective_to: string | null;
  source?: string;
  values: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RateTableDocument {
  key: string;
  title?: string;
  statute?: string;
  notes?: string[];
  versions: RateTableVersion[];
  [key: string]: unknown;
}
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, body, 'utf8');

console.log(`Wrote ${outFile}`);
console.log(`  ${files.length} tables, sha256 ${checksum}`);
