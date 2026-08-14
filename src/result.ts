import { Money } from './money.js';

export type StepContext = Record<string, string | number | boolean>;

export interface StepJson {
  label: string;
  amount?: number;
  formatted?: string;
  formula?: string;
  citation?: string;
  context?: StepContext;
}

export interface StepInit {
  label: string;
  amount?: Money | null;
  formula?: string | null;
  citation?: string | null;
  context?: StepContext;
}

/**
 * One line of the working behind a calculation.
 *
 * Deliberately minimal: a label, an optional amount, the arithmetic as text,
 * and the rule it rests on. Presentation is the caller's concern.
 */
export class Step {
  readonly label: string;
  readonly amount: Money | null;
  readonly formula: string | null;
  readonly citation: string | null;
  readonly context: StepContext;

  constructor(init: StepInit) {
    this.label = init.label;
    this.amount = init.amount ?? null;
    this.formula = init.formula ?? null;
    this.citation = init.citation ?? null;
    this.context = init.context ?? {};
    Object.freeze(this);
  }

  toJSON(): StepJson {
    const out: StepJson = { label: this.label };

    if (this.amount !== null) {
      out.amount = this.amount.toRupees();
      out.formatted = this.amount.format();
    }
    if (this.formula !== null) out.formula = this.formula;
    if (this.citation !== null) out.citation = this.citation;
    if (Object.keys(this.context).length > 0) out.context = this.context;

    return out;
  }
}

export const step = (init: StepInit): Step => new Step(init);

export interface CalculationResultJson {
  [key: string]: unknown;
  explanation: string;
  steps: StepJson[];
  citations: string[];
}

/**
 * Base for every calculator result: holds the working and the citations so
 * concrete results only have to declare their own figures.
 *
 * The public shape - `amount`, `workings`, `citations` - is the contract the
 * PHP package and this one share, so a result computed in a browser and one
 * computed on a server are interchangeable across the wire.
 */
export abstract class Result {
  /** The ordered working, one entry per step. */
  workings: readonly Step[] = [];

  /** The statutes, rules or notifications the calculation rests on. */
  citations: readonly string[] = [];

  /** The headline figure. Every result has one. */
  abstract get amount(): Money;

  /**
   * A human-readable one-line summary of the formula, with the actual operands
   * substituted in - e.g. "(15 × 45000 × 8) ÷ 26".
   */
  abstract explain(): string;

  /**
   * The result as a plain, serialisable object. Keys are snake_case and values
   * are scalars or nested objects only, matching the PHP `toArray()` exactly.
   */
  abstract toArray(): Record<string, unknown>;

  /** Alias for `workings`, for callers coming from the PHP `steps()` method. */
  get steps(): readonly Step[] {
    return this.workings;
  }

  protected withWorking(steps: Step[], citations: string[] = []): this {
    this.workings = steps;

    const source = citations.length > 0 ? citations : steps.map((entry) => entry.citation);
    const seen = new Set<string>();

    for (const citation of source) {
      if (citation) seen.add(citation);
    }

    this.citations = [...seen];

    return this;
  }

  /**
   * A plain-text rendering of the working, one step per line. Handy in a CLI, a
   * log line, or the bottom of a payslip.
   */
  workingsText(): string {
    return this.workings
      .map((entry) => {
        let line = entry.label;
        if (entry.formula !== null) line += ` = ${entry.formula}`;
        if (entry.amount !== null) line += ` → ${entry.amount.format()}`;
        return line;
      })
      .join('\n');
  }

  toJSON(): CalculationResultJson {
    return {
      ...this.toArray(),
      explanation: this.explain(),
      steps: this.workings.map((entry) => entry.toJSON()),
      citations: [...this.citations],
    };
  }
}

/** `Money | null` to a `{value, formatted}` pair of snake_case keys. */
export function moneyPair(prefix: string, amount: Money | null): Record<string, unknown> {
  return {
    [prefix]: amount === null ? null : amount.toRupees(),
    [`${prefix}_formatted`]: amount === null ? null : amount.format(),
  };
}
