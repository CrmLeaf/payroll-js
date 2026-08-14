/**
 * @crmleaf/payroll-js - Indian payroll calculations that show their working.
 *
 * The JavaScript counterpart to crmleaf/payroll-core. Same statutory rate tables,
 * same integer-paise arithmetic, same result shape, so a figure computed in a
 * browser and one computed on a PHP server agree to the paisa.
 */

export { Money, money, phpRound, rateLabel, type MoneyJson } from './money.js';
export {
  Result,
  Step,
  step,
  type CalculationResultJson,
  type StepContext,
  type StepInit,
  type StepJson,
} from './result.js';
export {
  InvalidInputError,
  InvalidMoneyError,
  PayrollError,
  RateNotFoundError,
} from './errors.js';
export {
  RATES_CHECKSUM,
  RATE_TABLES,
  RATE_TABLE_KEYS,
  RateRepository,
  RateTable,
  defaultRates,
  type RateTableDocument,
} from './rates/index.js';
export {
  type DateInput,
  financialYearOf,
  financialYearStart,
  formatDate,
  toDate,
} from './dates.js';

export * from './calculators/ctc.js';
export * from './calculators/tds.js';
export * from './calculators/pf.js';
export * from './calculators/esi.js';
export * from './calculators/gratuity.js';
export * from './calculators/bonus.js';
export * from './calculators/leave-encashment.js';
export * from './calculators/fnf.js';
export * from './calculators/epfo-penalty.js';
export * from './calculators/compliance-calendar.js';
export * from './calculators/roi.js';
export * from './calculators/savings.js';
export * from './calculators/income-tax.js';
export * from './calculators/professional-tax.js';
export * from './calculators/payslip.js';
export * from './calculators/invoice.js';
export * from './calculators/salary-templates.js';

export { TOOLS, type ToolDefinition, type ToolField } from './ui/tools.js';
export { definePayrollElements, mountPayrollTools } from './ui/elements.js';
