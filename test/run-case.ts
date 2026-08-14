import type { Result } from '../src/result.js';
import { calculateBonus } from '../src/calculators/bonus.js';
import { complianceCalendar } from '../src/calculators/compliance-calendar.js';
import { calculateCtc } from '../src/calculators/ctc.js';
import { calculateEpfoPenalty } from '../src/calculators/epfo-penalty.js';
import { calculateEsi } from '../src/calculators/esi.js';
import { calculateFnf } from '../src/calculators/fnf.js';
import { calculateGratuity } from '../src/calculators/gratuity.js';
import { calculateIncomeTax } from '../src/calculators/income-tax.js';
import { calculateLeaveEncashment } from '../src/calculators/leave-encashment.js';
import { calculatePf } from '../src/calculators/pf.js';
import { calculateRoi } from '../src/calculators/roi.js';
import { calculateSavings } from '../src/calculators/savings.js';
import { calculateTds } from '../src/calculators/tds.js';

type Input = Record<string, never> & Record<string, unknown>;

/**
 * The mirror of `run()` in scripts/generate-parity-fixture.php. Same tool names,
 * same input keys, so a fixture case can be replayed here without translation.
 */
export function runCase(tool: string, input: Record<string, unknown>): Result {
  const i = input as Input;

  switch (tool) {
    case 'pf':
      return calculatePf(i as never);
    case 'esi':
      return calculateEsi(i as never);
    case 'gratuity':
      return calculateGratuity(i as never);
    case 'bonus':
      return calculateBonus(i as never);
    case 'leaveEncashment':
      return calculateLeaveEncashment(i as never);
    case 'incomeTax':
      return calculateIncomeTax(i as never);
    case 'tds':
      return calculateTds(i as never);
    case 'ctc':
      return calculateCtc(i as never);
    case 'fnf':
      return calculateFnf(i as never);
    case 'epfoPenalty':
      return calculateEpfoPenalty(i as never);
    case 'complianceCalendar':
      return complianceCalendar(i as never);
    case 'roi':
      return calculateRoi(i as never);
    case 'savings':
      return calculateSavings(i as never);
    default:
      throw new Error(`Unknown tool "${tool}".`);
  }
}
