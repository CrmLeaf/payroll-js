import { type DateInput, formatDate, toDate } from '../dates.js';
import { InvalidInputError } from '../errors.js';
import { Money, phpRound, rateLabel } from '../money.js';
import { RateRepository, type RateTable, defaultRates } from '../rates/index.js';
import { Result, Step } from '../result.js';

/**
 * Slab comparison tolerance. Rates arrive as floats from JSON and from form
 * input, and 18.0 read out of one is not always bit-identical to 18 read out of
 * the other.
 */
const RATE_EPSILON = 0.0001;

/** 'intra' where the supplier and the place of supply share a state, else 'inter'. */
export type SupplyType = 'intra' | 'inter';

export interface InvoiceItemInput {
  description: string;
  /**
   * Rule 46(f) asks for the HSN of goods or the SAC of services in the same
   * column, so either key names the same field.
   */
  sac?: string;
  hsn?: string;
  quantity: number | string;
  rate: Money | number | string;
  gstRate: number | string;
  discount?: Money | number | string;
}

export interface InvoiceInput {
  invoiceNumber: string;
  invoiceDate: Date | string;
  sellerState: string;
  /** The place of supply. A two-digit GST state code is accepted as readily as a name. */
  buyerState: string;
  items: InvoiceItemInput[];
  /**
   * The recipient's registration. Validated for shape and checksum when given;
   * an empty string is an unregistered recipient, which is not an error.
   */
  buyerGstin?: string;
  /**
   * Where the recipient is liable for the tax under section 9(3) or 9(4), the
   * invoice discloses the tax but does not collect it.
   */
  reverseCharge?: boolean;
  /**
   * Overrides the rate version; defaults to the invoice date, so an invoice
   * raised late still applies the law of its own date.
   */
  asOf?: DateInput;
}

/** One invoice line, valued and taxed. Keys are the wire shape, so snake_case. */
export interface InvoiceLine {
  position: number;
  description: string;
  sac: string;
  quantity: number;
  rate: Money;
  gross_value: Money;
  discount: Money;
  taxable_value: Money;
  gst_rate: number;
  cgst_rate: number;
  sgst_rate: number;
  igst_rate: number;
  cgst: Money;
  sgst: Money;
  igst: Money;
}

export interface MandatoryParticular {
  clause: string;
  particular: string;
}

const WORD_ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
] as const;

const WORD_TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
] as const;

/**
 * A GST tax invoice: the lines, the tax heads the place of supply demands, and
 * the payable rounded to the rupee.
 *
 * The field that matters most here is `supplyType`. Everything downstream of it
 * - whether `cgst` and `sgst` carry the tax or `igst` does, which government the
 * money reaches, whether the recipient can take credit - follows from that one
 * decision, and it is a fact about the place of supply rather than a setting.
 * It is exposed as a first-class field so a template can never quietly print the
 * wrong pair of columns.
 */
export class InvoiceResult extends Result {
  constructor(
    readonly invoiceNumber: string,
    readonly invoiceDate: Date,
    readonly sellerState: string,
    readonly sellerStateCode: string,
    readonly buyerState: string,
    readonly buyerStateCode: string,
    readonly buyerGstin: string,
    readonly supplyType: SupplyType,
    readonly lines: InvoiceLine[],
    readonly grossValue: Money,
    readonly totalDiscount: Money,
    readonly taxableTotal: Money,
    readonly cgst: Money,
    readonly sgst: Money,
    readonly igst: Money,
    readonly totalTax: Money,
    readonly totalBeforeRounding: Money,
    readonly roundOff: Money,
    readonly grandTotal: Money,
    readonly reverseCharge: boolean,
    readonly reverseChargeDeclaration: string | null = null,
    /**
     * Things worth telling the issuer about that do not make the invoice wrong -
     * a buyer GSTIN registered in a state other than the place of supply,
     * chiefly.
     */
    readonly warnings: string[] = [],
    readonly mandatoryParticulars: MandatoryParticular[] = [],
  ) {
    super();
  }

  get amount(): Money {
    return this.grandTotal;
  }

  static make(steps: Step[], fields: ConstructorParameters<typeof InvoiceResult>): InvoiceResult {
    return new InvoiceResult(...fields).withWorking(steps);
  }

  isInterState(): boolean {
    return this.supplyType === 'inter';
  }

  /** 'IGST' or 'CGST + SGST' - the column heading the invoice needs. */
  taxHead(): string {
    return this.isInterState() ? 'IGST' : 'CGST + SGST';
  }

  /**
   * The amount the supplier actually collects. On a reverse charge supply that
   * is the taxable value alone: the tax is computed and disclosed, but the
   * recipient pays it to the government directly.
   */
  amountCollected(): Money {
    return this.grandTotal;
  }

  /**
   * "Rupees Fifty Nine Thousand Only" - rule 46 does not require the words, but
   * every Indian invoice carries them and a cheque drawn against one is read
   * from the words rather than the figures.
   *
   * Written out here rather than borrowed from a formatter package because
   * `Intl.NumberFormat` renders a lakh as "hundred thousand" in several ICU
   * versions, and a tax invoice that says "hundred thousand" is not an Indian
   * invoice.
   */
  amountInWords(): string {
    return InvoiceResult.toWords(this.grandTotal);
  }

  explain(): string {
    const tax = this.isInterState()
      ? `IGST ${this.igst.format()}`
      : `CGST ${this.cgst.format()} + SGST ${this.sgst.format()}`;

    return (
      `Tax invoice ${this.invoiceNumber} dated ${formatDate(this.invoiceDate, 'd-m-Y')}: ` +
      `${this.sellerState} (${this.sellerStateCode}) → ${this.buyerState} (${this.buyerStateCode}) is an ` +
      `${this.supplyType}-state supply, so the tax is ${tax}. Taxable value ${this.taxableTotal.format()}, ` +
      `tax ${this.totalTax.format()}, ` +
      `${
        this.reverseCharge
          ? 'tax payable by the recipient on reverse charge so the invoice total excludes it'
          : 'total'
      } = ${this.totalBeforeRounding.format()}, rounded to ${this.grandTotal.format()} ` +
      `(round-off ${this.roundOff.format()}).`
    );
  }

  toArray(): Record<string, unknown> {
    return {
      invoice_number: this.invoiceNumber,
      invoice_date: formatDate(this.invoiceDate, 'Y-m-d'),
      seller_state: this.sellerState,
      seller_state_code: this.sellerStateCode,
      buyer_state: this.buyerState,
      buyer_state_code: this.buyerStateCode,
      buyer_gstin: this.buyerGstin,
      place_of_supply: `${this.buyerState} (${this.buyerStateCode})`,
      supply_type: this.supplyType,
      tax_head: this.taxHead(),

      lines: this.lines.map(lineToArray),

      gross_value: this.grossValue.toRupees(),
      gross_value_formatted: this.grossValue.format(),
      total_discount: this.totalDiscount.toRupees(),
      total_discount_formatted: this.totalDiscount.format(),
      taxable_total: this.taxableTotal.toRupees(),
      taxable_total_formatted: this.taxableTotal.format(),
      cgst: this.cgst.toRupees(),
      cgst_formatted: this.cgst.format(),
      sgst: this.sgst.toRupees(),
      sgst_formatted: this.sgst.format(),
      igst: this.igst.toRupees(),
      igst_formatted: this.igst.format(),
      total_tax: this.totalTax.toRupees(),
      total_tax_formatted: this.totalTax.format(),
      total_before_rounding: this.totalBeforeRounding.toRupees(),
      total_before_rounding_formatted: this.totalBeforeRounding.format(),
      round_off: this.roundOff.toRupees(),
      round_off_formatted: this.roundOff.format(),
      grand_total: this.grandTotal.toRupees(),
      grand_total_formatted: this.grandTotal.format(),
      amount_in_words: this.amountInWords(),

      reverse_charge: this.reverseCharge,
      reverse_charge_declaration: this.reverseChargeDeclaration,
      warnings: this.warnings,
      mandatory_particulars: this.mandatoryParticulars,
    };
  }

  private static toWords(amount: Money): string {
    const paise = Math.abs(amount.paise);
    let words = `Rupees ${InvoiceResult.words(Math.trunc(paise / 100))}`;

    if (paise % 100 > 0) {
      words += ` and ${InvoiceResult.words(paise % 100)} Paise`;
    }

    return `${amount.isNegative() ? 'Minus ' : ''}${words} Only`;
  }

  private static words(value: number): string {
    if (value === 0) {
      return 'Zero';
    }

    let remaining = value;
    const parts: string[] = [];

    // Indian units stop being powers of a thousand after the first: past
    // thousand come lakh (10^5) and crore (10^7), so the divisors step by a
    // hundred rather than by a thousand.
    for (const [divisor, label] of [
      [10_000_000, 'Crore'],
      [100_000, 'Lakh'],
      [1_000, 'Thousand'],
      [100, 'Hundred'],
    ] as const) {
      if (remaining >= divisor) {
        parts.push(`${InvoiceResult.words(Math.trunc(remaining / divisor))} ${label}`);
        remaining %= divisor;
      }
    }

    if (remaining > 0) {
      parts.push(
        remaining < 20
          ? WORD_ONES[remaining]
          : `${WORD_TENS[Math.trunc(remaining / 10)]} ${WORD_ONES[remaining % 10]}`.trim(),
      );
    }

    return parts.join(' ');
  }
}

function lineToArray(line: InvoiceLine): Record<string, unknown> {
  const row: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(line)) {
    if (value instanceof Money) {
      row[key] = value.toRupees();
      row[`${key}_formatted`] = value.format();

      continue;
    }

    row[key] = value;
  }

  return row;
}

/**
 * A GST tax invoice: line values, the right tax heads, and the payable rounded
 * to the rupee.
 *
 * One decision in here matters more than all the arithmetic around it. Whether
 * the tax lands as CGST plus SGST or as IGST is not a preference, not a
 * per-customer setting and not something to infer from the buyer's GSTIN: it
 * follows from the place of supply. Same state as the supplier, and the notified
 * rate splits in half between the centre and the state; different state, and the
 * whole of it is integrated tax. Getting it backwards does not produce a
 * rounding error - it pays the money to a government that is not entitled to it
 * and leaves the recipient unable to claim the credit. So the decision is made
 * once, explicitly, near the top, and carried on the result as a field a
 * template cannot ignore.
 */
export class InvoiceGenerator {
  constructor(private readonly rates: RateRepository = defaultRates) {}

  calculate(input: InvoiceInput): InvoiceResult {
    const invoiceDate = invoiceDateOf(input.invoiceDate);
    const asOf = input.asOf ?? invoiceDate;

    const table = this.rates.for('gst', asOf);
    const citations = table.record<string>('citations');

    const invoiceNumber = validateInvoiceNumber(input.invoiceNumber, table);

    const stateCodes = table.record<string>('state_codes');
    const sellerCode = resolveState(input.sellerState, stateCodes, 'Seller state');
    const buyerCode = resolveState(input.buyerState, stateCodes, 'Place of supply');

    // The whole invoice turns on this comparison.
    const interState = sellerCode !== buyerCode;
    const supplyType: SupplyType = interState ? 'inter' : 'intra';

    const [buyerGstin, warnings] = validateGstin(input.buyerGstin ?? '', buyerCode, stateCodes, table);

    const items = input.items ?? [];

    if (items.length === 0) {
      throw InvalidInputError.outOfRange('Items', 'at least one line', 0);
    }

    const steps: Step[] = [
      new Step({
        label: 'Place of supply',
        formula:
          `${stateCodes[sellerCode]} (${sellerCode}) → ${stateCodes[buyerCode]} (${buyerCode}): ` +
          `${interState ? 'different states' : 'the same state'}, so the supply is ${supplyType}-state and ` +
          `the tax is ${interState ? 'IGST at the full rate' : 'CGST and SGST at half the rate each'}`,
        citation: citations['place_of_supply'],
        context: { supply_type: supplyType, inter_state: interState },
      }),
    ];

    const slabs = table.array<number>('slabs').map(Number);
    const divisor = table.float('intra_state_divisor');

    const lines: InvoiceLine[] = [];
    let grossValue = Money.zero();
    let totalDiscount = Money.zero();
    let taxableTotal = Money.zero();
    let cgstTotal = Money.zero();
    let sgstTotal = Money.zero();
    let igstTotal = Money.zero();

    for (const [index, item] of items.entries()) {
      const line = buildLine(item, index, slabs, interState, divisor);

      lines.push(line);
      grossValue = grossValue.add(line.gross_value);
      totalDiscount = totalDiscount.add(line.discount);
      taxableTotal = taxableTotal.add(line.taxable_value);
      cgstTotal = cgstTotal.add(line.cgst);
      sgstTotal = sgstTotal.add(line.sgst);
      igstTotal = igstTotal.add(line.igst);

      for (const step of lineSteps(line, index, interState, citations)) {
        steps.push(step);
      }
    }

    steps.push(
      new Step({
        label: 'Total taxable value',
        amount: taxableTotal,
        formula: totalDiscount.isZero()
          ? `sum of ${lines.length} line${lines.length === 1 ? '' : 's'}`
          : `${grossValue.format()} less discount of ${totalDiscount.format()}`,
        citation: citations['value_of_supply'],
      }),
    );

    if (interState) {
      steps.push(
        new Step({
          label: 'IGST',
          amount: igstTotal,
          citation: citations['inter_state_levy'],
        }),
      );
    } else {
      steps.push(
        new Step({
          label: 'CGST',
          amount: cgstTotal,
          citation: citations['intra_state_levy'],
        }),
        new Step({
          label: 'SGST',
          amount: sgstTotal,
          citation: citations['intra_state_levy'],
        }),
      );
    }

    const totalTax = cgstTotal.add(sgstTotal, igstTotal);
    const reverseCharge = input.reverseCharge ?? false;

    // Reverse charge does not remove the tax from the invoice - rule 46(l)
    // still wants it disclosed under each head. It removes it from what the
    // supplier collects, because the recipient pays it to the government
    // themselves under section 9(3) or 9(4).
    let declaration: string | null = null;

    if (reverseCharge) {
      declaration = table.string('reverse_charge_declaration');

      steps.push(
        new Step({
          label: 'Tax payable by the recipient on reverse charge basis',
          amount: totalTax,
          formula:
            'disclosed on the invoice but not collected, so the invoice total is the taxable value alone',
          citation: citations['reverse_charge'],
        }),
      );
    }

    const totalBeforeRounding = reverseCharge ? taxableTotal : taxableTotal.add(totalTax);

    // Section 170 rounds the payable to the nearest rupee. The difference is
    // shown rather than absorbed: the recipient reconciles the credit they claim
    // against the tax charged, and a silently dropped forty paise breaks that
    // reconciliation.
    const grandTotal = roundOffTo(totalBeforeRounding, table);
    const roundOff = grandTotal.subtract(totalBeforeRounding);

    steps.push(
      new Step({
        label: 'Round off',
        amount: roundOff,
        formula: `${totalBeforeRounding.format()} → ${grandTotal.format()}`,
        citation: citations['rounding'],
      }),
      new Step({
        label: 'Invoice total',
        amount: grandTotal,
        formula: reverseCharge
          ? `${taxableTotal.format()} taxable value; tax of ${totalTax.format()} is payable by the recipient`
          : `${taxableTotal.format()} + ${totalTax.format()} tax`,
        citation: citations['invoice_particulars'],
      }),
    );

    return InvoiceResult.make(steps, [
      invoiceNumber,
      invoiceDate,
      stateCodes[sellerCode],
      sellerCode,
      stateCodes[buyerCode],
      buyerCode,
      buyerGstin,
      supplyType,
      lines,
      grossValue,
      totalDiscount,
      taxableTotal,
      cgstTotal,
      sgstTotal,
      igstTotal,
      totalTax,
      totalBeforeRounding,
      roundOff,
      grandTotal,
      reverseCharge,
      declaration,
      warnings,
      particulars(table),
    ]);
  }
}

/** One invoice line, valued and taxed. */
function buildLine(
  item: InvoiceItemInput,
  index: number,
  slabs: number[],
  interState: boolean,
  divisor: number,
): InvoiceLine {
  const position = index + 1;

  const description = String(item.description ?? '').trim();

  if (description === '') {
    throw InvalidInputError.outOfRange(
      `Line ${position} description`,
      'a non-empty description, as rule 46(g) requires',
      description,
    );
  }

  // Rule 46(f) asks for the HSN of goods or the SAC of services in the same
  // column, so either key names the same field.
  const sac = String(item.sac ?? item.hsn ?? '').trim();

  if (sac === '') {
    throw InvalidInputError.outOfRange(
      `Line ${position} HSN or SAC`,
      'an HSN or SAC code, as rule 46(f) requires',
      sac,
    );
  }

  const quantity = numeric(item.quantity, `Line ${position} quantity`);

  if (quantity <= 0) {
    throw InvalidInputError.outOfRange(`Line ${position} quantity`, 'above zero', quantity);
  }

  const rate = moneyFrom(item.rate, `Line ${position} rate`);

  if (rate.isNegative()) {
    throw InvalidInputError.negative(`Line ${position} rate`);
  }

  const discount = moneyFrom(item.discount ?? 0, `Line ${position} discount`);

  if (discount.isNegative()) {
    throw InvalidInputError.negative(`Line ${position} discount`);
  }

  const gstRate = numeric(item.gstRate, `Line ${position} GST rate`);

  if (!isSlab(gstRate, slabs)) {
    throw InvalidInputError.outOfRange(
      `Line ${position} GST rate`,
      `one of the notified slabs ${slabs.map(rateLabel).join(', ')} per cent`,
      rateLabel(gstRate),
    );
  }

  const grossValue = rate.multiply(quantity);

  // Section 15(3)(a): a discount given at the time of supply and shown on the
  // invoice comes out of the value of supply, so it is taxed on the net rather
  // than deducted from the gross afterwards.
  const taxableValue = grossValue.subtract(discount);

  if (taxableValue.isNegative()) {
    throw InvalidInputError.outOfRange(
      `Line ${position} discount`,
      `no more than the line value of ${grossValue.format()}`,
      discount.format(),
    );
  }

  // Each head is computed on its own half-rate rather than by halving the total
  // tax, which is what the two State and Central returns are filed on and keeps
  // each head correct to the paise in its own right.
  const halfRate = gstRate / divisor;

  return {
    position,
    description,
    sac,
    quantity,
    rate,
    gross_value: grossValue,
    discount,
    taxable_value: taxableValue,
    gst_rate: gstRate,
    cgst_rate: interState ? 0 : halfRate,
    sgst_rate: interState ? 0 : halfRate,
    igst_rate: interState ? gstRate : 0,
    cgst: interState ? Money.zero() : taxableValue.percentage(halfRate),
    sgst: interState ? Money.zero() : taxableValue.percentage(halfRate),
    igst: interState ? taxableValue.percentage(gstRate) : Money.zero(),
  };
}

function lineSteps(
  line: InvoiceLine,
  index: number,
  interState: boolean,
  citations: Record<string, string>,
): Step[] {
  const taxableValue = line.taxable_value;
  const label = `Line ${index + 1} - ${line.description} (${line.sac})`;

  const steps: Step[] = [
    new Step({
      label,
      amount: taxableValue,
      formula: line.discount.isZero()
        ? `${quantityLabel(line.quantity)} × ${line.rate.format()}`
        : `(${quantityLabel(line.quantity)} × ${line.rate.format()}) − ${line.discount.format()} discount`,
      citation: citations['value_of_supply'],
      context: { sac: line.sac, quantity: line.quantity },
    }),
  ];

  if (interState) {
    steps.push(
      new Step({
        label: `Line ${index + 1} IGST at ${rateLabel(line.igst_rate)}%`,
        amount: line.igst,
        formula: `${rateLabel(line.igst_rate)}% × ${taxableValue.format()}`,
        citation: citations['inter_state_levy'],
      }),
    );

    return steps;
  }

  for (const [key, head] of [
    ['cgst', 'CGST'],
    ['sgst', 'SGST'],
  ] as const) {
    const rate = key === 'cgst' ? line.cgst_rate : line.sgst_rate;

    steps.push(
      new Step({
        label: `Line ${index + 1} ${head} at ${rateLabel(rate)}%`,
        amount: line[key],
        formula:
          `${rateLabel(rate)}% × ${taxableValue.format()} - half of the ` +
          `${rateLabel(line.gst_rate)}% slab`,
        citation: citations['intra_state_levy'],
      }),
    );
  }

  return steps;
}

/**
 * The recipient's GSTIN, checked for shape and checksum.
 *
 * A mistyped registration number is a caller error and is refused, because an
 * invoice carrying one denies the recipient their credit. A registration in a
 * state other than the place of supply is *not* an error - a Karnataka-registered
 * buyer can lawfully take delivery in Tamil Nadu - so that comes back as a
 * warning on the result instead.
 */
function validateGstin(
  raw: string,
  buyerCode: string,
  stateCodes: Record<string, string>,
  table: RateTable,
): [string, string[]] {
  const gstin = String(raw ?? '').trim().toUpperCase();

  if (gstin === '') {
    return ['', []];
  }

  const length = table.int('gstin.length');

  if (gstin.length !== length) {
    throw InvalidInputError.outOfRange(
      'Buyer GSTIN',
      `exactly ${length} characters`,
      `${gstin} (${gstin.length} characters)`,
    );
  }

  if (!new RegExp(table.string('gstin.pattern')).test(gstin)) {
    throw InvalidInputError.outOfRange(
      'Buyer GSTIN',
      'a two-digit state code, a ten-character PAN, an entity digit, the letter ' +
        `${table.string('gstin.fourteenth_character')} and a checksum character - for example 27AAPFU0939F1ZV`,
      gstin,
    );
  }

  const expected = checksumCharacter(gstin, table);

  if (gstin[length - 1] !== expected) {
    throw InvalidInputError.outOfRange(
      'Buyer GSTIN',
      `a valid MOD-36 checksum - ${gstin.slice(0, length - 1)} should end in "${expected}"`,
      gstin,
    );
  }

  const gstinCode = gstin.slice(0, 2);

  if (!(gstinCode in stateCodes)) {
    throw InvalidInputError.unknownOption(
      'GST state code in the buyer GSTIN',
      gstinCode,
      codeList(stateCodes),
    );
  }

  const warnings: string[] = [];

  if (gstinCode !== buyerCode) {
    warnings.push(
      `Buyer GSTIN ${gstin} is registered in ${stateCodes[gstinCode]} (${gstinCode}) but the place of ` +
        `supply is ${stateCodes[buyerCode]} (${buyerCode}). That is lawful where delivery is elsewhere, ` +
        'but check it: the two normally agree, and if the place of supply is wrong so is the choice ' +
        'between IGST and CGST plus SGST.',
    );
  }

  return [gstin, warnings];
}

/**
 * The MOD-36 check character of a GSTIN.
 *
 * Every character maps to its index in 0-9A-Z. Positions are weighted 1, 2, 1,
 * 2 … from the left, and *both digits* of each base-36 product go into the sum -
 * which is the part hand-rolled implementations drop, and why they accept
 * transpositions the portal rejects.
 */
function checksumCharacter(gstin: string, table: RateTable): string {
  const charset = table.string('gstin.checksum_charset');
  const over = table.int('gstin.checksum_over_characters');
  const base = charset.length;
  let sum = 0;

  for (let position = 0; position < over; position += 1) {
    const value = charset.indexOf(gstin[position]);

    if (value === -1) {
      throw InvalidInputError.outOfRange(
        'Buyer GSTIN',
        `made up only of the characters ${charset}`,
        gstin,
      );
    }

    const product = value * (position % 2 === 0 ? 1 : 2);
    sum += Math.trunc(product / base) + (product % base);
  }

  return charset[(base - (sum % base)) % base];
}

function validateInvoiceNumber(raw: string, table: RateTable): string {
  const invoiceNumber = String(raw ?? '').trim();
  const maxLength = table.int('invoice_number_max_length');

  if (!new RegExp(table.string('invoice_number_pattern')).test(invoiceNumber)) {
    throw InvalidInputError.outOfRange(
      'Invoice number',
      `at most ${maxLength} characters of letters, numerals, hyphen and slash, as rule 46(b) requires`,
      invoiceNumber,
    );
  }

  return invoiceNumber;
}

function resolveState(raw: string, stateCodes: Record<string, string>, field: string): string {
  const state = String(raw ?? '').trim();

  if (state === '') {
    throw InvalidInputError.outOfRange(field, 'a state name or two-digit GST state code', state);
  }

  // A two-digit code is accepted as readily as a name: the field is filled from
  // a GSTIN as often as it is typed out.
  if (/^\d{1,2}$/.test(state)) {
    const code = state.padStart(2, '0');

    if (code in stateCodes) {
      return code;
    }

    throw InvalidInputError.unknownOption(field, state, codeList(stateCodes));
  }

  const needle = normaliseState(state);

  for (const [code, name] of Object.entries(stateCodes)) {
    if (normaliseState(name) === needle) {
      return code.padStart(2, '0');
    }
  }

  throw InvalidInputError.unknownOption(field, state, Object.values(stateCodes));
}

function normaliseState(state: string): string {
  return state.replace(/[^a-z]/gi, '').toLowerCase();
}

function codeList(stateCodes: Record<string, string>): string[] {
  return Object.keys(stateCodes).map((code) => code.padStart(2, '0'));
}

function isSlab(rate: number, slabs: number[]): boolean {
  return slabs.some((slab) => Math.abs(slab - rate) < RATE_EPSILON);
}

function particulars(table: RateTable): MandatoryParticular[] {
  return table.array<Partial<MandatoryParticular>>('invoice_particulars').map((entry) => ({
    clause: String(entry.clause ?? ''),
    particular: String(entry.particular ?? ''),
  }));
}

function roundOffTo(amount: Money, table: RateTable): Money {
  const multiple = table.int('round_off_to');

  return Money.fromPaise(phpRound(amount.paise / multiple) * multiple);
}

function invoiceDateOf(value: Date | string): Date {
  try {
    return toDate(value);
  } catch {
    throw InvalidInputError.outOfRange('Invoice date', 'a parseable date', value);
  }
}

/**
 * PHP's `is_numeric` gate, kept because the failure has to name the field. A
 * rate of "free" is a caller error, not a Money that happens not to parse.
 */
function numeric(value: unknown, field: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) {
    return Number(value.trim());
  }

  throw InvalidInputError.outOfRange(field, 'a number', value);
}

function moneyFrom(value: Money | number | string, field: string): Money {
  return value instanceof Money ? value : Money.fromRupees(numeric(value, field));
}

function quantityLabel(quantity: number): string {
  return quantity.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** A GST tax invoice under section 31 read with rules 46 and 47. */
export function calculateInvoice(input: InvoiceInput, rates?: RateRepository): InvoiceResult {
  return new InvoiceGenerator(rates).calculate(input);
}

/**
 * The name the single-tool package `@crmleaf/invoice-generator` re-exports. The
 * arithmetic lives here once, so a rate change cannot land in the suite and miss
 * the standalone package.
 */
export const invoice = calculateInvoice;
