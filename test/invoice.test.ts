import { describe, expect, it } from 'vitest';
import { InvalidInputError, RateNotFoundError } from '../src/errors.js';
import {
  type InvoiceItemInput,
  type InvoiceResult,
  calculateInvoice,
  invoice as invoiceAlias,
} from '../src/calculators/invoice.js';

/**
 * The same cases as PayrollCore's InvoiceGeneratorTest, with the same inputs and
 * the same expected paise. A figure that differs between the two engines is a
 * figure a customer will see differ between their server and their browser.
 */
const INVOICE_DATE = '2025-08-01';

/**
 * A GSTIN whose MOD-36 check character is genuinely correct - the sample
 * registration the GST portal's own documentation uses. Maharashtra, 27.
 */
const VALID_GSTIN = '27AAPFU0939F1ZV';

/**
 * The same registration with the check character replaced. Every other character
 * is untouched, so anything that passes this is not checking the checksum at all.
 */
const BAD_CHECKSUM_GSTIN = '27AAPFU0939F1ZA';

function line(overrides: Partial<InvoiceItemInput> = {}): InvoiceItemInput {
  return {
    description: 'Payroll processing services',
    sac: '998221',
    quantity: 1,
    rate: 50000,
    gstRate: 18,
    ...overrides,
  };
}

function invoice(
  items: InvoiceItemInput[],
  options: { sellerState?: string; buyerState?: string; buyerGstin?: string; reverseCharge?: boolean } = {},
): InvoiceResult {
  return calculateInvoice({
    invoiceNumber: 'INV-2025-0001',
    invoiceDate: INVOICE_DATE,
    sellerState: options.sellerState ?? 'Karnataka',
    buyerState: options.buyerState ?? 'Karnataka',
    items,
    buyerGstin: options.buyerGstin ?? '',
    reverseCharge: options.reverseCharge ?? false,
    asOf: INVOICE_DATE,
  });
}

describe('the place of supply, which the whole invoice turns on', () => {
  it('splits the slab into equal CGST and SGST halves within one state', () => {
    const result = invoice([line()], { sellerState: 'Karnataka', buyerState: 'Karnataka' });

    expect(result.supplyType).toBe('intra');
    expect(result.isInterState()).toBe(false);
    expect(result.taxHead()).toBe('CGST + SGST');

    expect(result.taxableTotal.paise).toBe(5000000);
    expect(result.cgst.paise).toBe(450000);
    expect(result.sgst.paise).toBe(450000);
    expect(result.igst.paise).toBe(0);
    expect(result.totalTax.paise).toBe(900000);
    expect(result.grandTotal.paise).toBe(5900000);

    expect(result.lines[0].cgst_rate).toBe(9);
    expect(result.lines[0].sgst_rate).toBe(9);
    expect(result.lines[0].igst_rate).toBe(0);
  });

  it('carries the whole slab as IGST across states', () => {
    const result = invoice([line()], { sellerState: 'Karnataka', buyerState: 'Maharashtra' });

    expect(result.supplyType).toBe('inter');
    expect(result.taxHead()).toBe('IGST');

    expect(result.igst.paise).toBe(900000);
    expect(result.cgst.paise).toBe(0);
    expect(result.sgst.paise).toBe(0);
    expect(result.totalTax.paise).toBe(900000);
    expect(result.grandTotal.paise).toBe(5900000);
    expect(result.lines[0].igst_rate).toBe(18);
  });

  it('raises the same total tax either way, under different heads', () => {
    const intra = invoice([line()], { buyerState: 'Karnataka' });
    const inter = invoice([line()], { buyerState: 'Maharashtra' });

    expect(intra.totalTax.paise).toBe(inter.totalTax.paise);
    expect(intra.grandTotal.paise).toBe(inter.grandTotal.paise);
    expect(intra.cgst.paise).not.toBe(inter.cgst.paise);
  });

  it('accepts a two-digit GST code in place of a state name', () => {
    const result = invoice([line()], { sellerState: '29', buyerState: '27' });

    expect(result.supplyType).toBe('inter');
    expect(result.sellerState).toBe('Karnataka');
    expect(result.buyerStateCode).toBe('27');
    expect(result.buyerState).toBe('Maharashtra');
  });

  it('matches state names without regard to case or punctuation', () => {
    const result = invoice([line()], { sellerState: 'tamil nadu', buyerState: 'TAMILNADU' });

    expect(result.supplyType).toBe('intra');
    expect(result.buyerStateCode).toBe('33');
  });

  it('refuses a place that is not in the GST code map', () => {
    expect(() => invoice([line()], { buyerState: 'Bangalore' })).toThrow(/Place of supply/);
  });

  it('records the decision as a step of its own', () => {
    const step = invoice([line()], { buyerState: 'Maharashtra' }).workings[0];

    expect(step.label).toBe('Place of supply');
    expect(step.citation).toContain('IGST Act 2017');
    expect(step.context.supply_type).toBe('inter');
    expect(step.formula).toContain('Karnataka (29) → Maharashtra (27)');
  });
});

describe('invoice line arithmetic', () => {
  /**
   * ₹1,000 at each of the five slabs, intra-state, so each head takes half:
   * 0% → 0, 5% → 2.5% = ₹25, 12% → 6% = ₹60, 18% → 9% = ₹90, 28% → 14% = ₹140.
   */
  it('taxes each line at its own slab', () => {
    const items = [0, 5, 12, 18, 28].map((slab) =>
      line({ description: `Line at ${slab}%`, rate: 1000, gstRate: slab }),
    );

    const result = invoice(items, { buyerState: 'Karnataka' });

    expect(result.taxableTotal.paise).toBe(500000);
    expect(result.cgst.paise).toBe(31500);
    expect(result.sgst.paise).toBe(31500);
    expect(result.totalTax.paise).toBe(63000);
    expect(result.grandTotal.paise).toBe(563000);

    expect(result.lines.map((entry) => entry.cgst.paise)).toEqual([0, 2500, 6000, 9000, 14000]);
  });

  it('takes a section 15(3)(a) discount out of the value the tax is charged on', () => {
    const result = invoice([line({ quantity: 2, rate: 1000, discount: 200 })], {
      buyerState: 'Maharashtra',
    });

    expect(result.grossValue.paise).toBe(200000);
    expect(result.totalDiscount.paise).toBe(20000);
    expect(result.taxableTotal.paise).toBe(180000);
    // 18% of ₹1,800, not of ₹2,000.
    expect(result.igst.paise).toBe(32400);
    expect(result.grandTotal.paise).toBe(212400);
  });

  it('refuses a discount larger than the line value', () => {
    expect(() => invoice([line({ quantity: 1, rate: 100, discount: 500 })])).toThrow(
      /Line 1 discount/,
    );
  });

  it('prices a fractional quantity through', () => {
    const result = invoice([line({ quantity: 2.5, rate: 400, gstRate: 12 })], {
      buyerState: 'Maharashtra',
    });

    expect(result.taxableTotal.paise).toBe(100000);
    expect(result.igst.paise).toBe(12000);
  });

  it('accepts an HSN wherever a SAC goes', () => {
    const result = invoice([
      { description: 'Desktop computer', hsn: '8471', quantity: 1, rate: 1000, gstRate: 18 },
    ]);

    expect(result.lines[0].sac).toBe('8471');
  });
});

describe('the section 170 round-off', () => {
  const cases: Array<[string, number, number, number, number]> = [
    // rate, taxable paise, round-off paise, grand total paise
    // ₹1,234.56 + 18% IGST of ₹222.22 = ₹1,456.78, which rounds up.
    ['a total above the half rupee rounds up', 1234.56, 123456, 22, 145700],
    // ₹1,000.20 + 18% IGST of ₹180.04 = ₹1,180.24, which rounds down.
    ['a total below the half rupee rounds down', 1000.2, 100020, -24, 118000],
    // A whole-rupee total needs no adjustment at all.
    ['a whole rupee total needs no adjustment', 50000, 5000000, 0, 5900000],
  ];

  for (const [name, rate, taxablePaise, roundOffPaise, grandTotalPaise] of cases) {
    it(`is shown rather than absorbed: ${name}`, () => {
      const result = invoice([line({ rate })], { buyerState: 'Maharashtra' });

      expect(result.taxableTotal.paise).toBe(taxablePaise);
      expect(result.roundOff.paise).toBe(roundOffPaise);
      expect(result.grandTotal.paise).toBe(grandTotalPaise);

      // The round-off has to reconcile, or the recipient cannot match the credit
      // they claim against the tax we charged.
      expect(result.totalBeforeRounding.add(result.roundOff).paise).toBe(result.grandTotal.paise);
      expect(result.grandTotal.paise % 100).toBe(0);
    });
  }
});

describe('reverse charge', () => {
  it('discloses the tax but excludes it from the total', () => {
    const result = invoice([line({ rate: 10000 })], {
      buyerState: 'Maharashtra',
      reverseCharge: true,
    });

    expect(result.reverseCharge).toBe(true);
    expect(result.taxableTotal.paise).toBe(1000000);
    expect(result.igst.paise).toBe(180000);
    expect(result.totalTax.paise).toBe(180000);
    // The supplier does not collect it.
    expect(result.grandTotal.paise).toBe(1000000);
    expect(result.roundOff.paise).toBe(0);

    expect(result.reverseChargeDeclaration).toContain('reverse charge basis');
    expect(result.toArray().reverse_charge_declaration).toContain('reverse charge basis');
  });

  it('collects the tax on the same supply without it', () => {
    const forward = invoice([line({ rate: 10000 })], { buyerState: 'Maharashtra' });
    const reverse = invoice([line({ rate: 10000 })], {
      buyerState: 'Maharashtra',
      reverseCharge: true,
    });

    expect(forward.totalTax.paise).toBe(reverse.totalTax.paise);
    expect(forward.grandTotal.paise).toBe(1180000);
    expect(reverse.grandTotal.paise).toBe(1000000);
    expect(forward.reverseChargeDeclaration).toBeNull();
  });
});

describe('the buyer GSTIN', () => {
  const valid: Array<[string, string]> = [
    // Published sample registrations whose MOD-36 check characters hold.
    [VALID_GSTIN, 'Maharashtra'],
    ['29AAGCB7383J1Z4', 'Karnataka'],
    ['09AAACH7409R1ZZ', 'Uttar Pradesh'],
  ];

  for (const [gstin, state] of valid) {
    it(`accepts ${gstin}, whose checksum holds`, () => {
      const result = invoice([line()], { buyerState: state, buyerGstin: gstin });

      expect(result.buyerGstin).toBe(gstin);
      expect(result.warnings).toEqual([]);
    });
  }

  it('uppercases and trims before checking', () => {
    const result = invoice([line()], {
      buyerState: 'Maharashtra',
      buyerGstin: `  ${VALID_GSTIN.toLowerCase()} `,
    });

    expect(result.buyerGstin).toBe(VALID_GSTIN);
  });

  it('refuses a broken checksum', () => {
    expect(() =>
      invoice([line()], { buyerState: 'Maharashtra', buyerGstin: BAD_CHECKSUM_GSTIN }),
    ).toThrow(/MOD-36 checksum/);
  });

  for (const [name, gstin] of [
    ['too short', '27AAPFU0939F1Z'],
    ['too long', '27AAPFU0939F1ZVV'],
    ['no state digits', 'XXAAPFU0939F1ZV'],
    ['PAN in the wrong shape', '27AAPF00939F1ZV'],
    ['the fourteenth character is not Z', '27AAPFU0939F1YV'],
  ] as Array<[string, string]>) {
    it(`refuses a malformed registration: ${name}`, () => {
      expect(() => invoice([line()], { buyerState: 'Maharashtra', buyerGstin: gstin })).toThrow(
        /Buyer GSTIN/,
      );
    });
  }

  it('needs none for an unregistered buyer, and raises no warning', () => {
    const result = invoice([line()], { buyerGstin: '' });

    expect(result.buyerGstin).toBe('');
    expect(result.warnings).toEqual([]);
  });

  /**
   * A registration in one state and a place of supply in another is lawful -
   * delivery can be elsewhere - so it warns rather than throws.
   */
  it('warns without failing when the registration is in another state', () => {
    const result = invoice([line()], {
      sellerState: 'Karnataka',
      buyerState: 'Karnataka',
      buyerGstin: VALID_GSTIN,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('Maharashtra (27)');
    expect(result.warnings[0]).toContain('Karnataka (29)');

    // The supply is still taxed on the place of supply, not on the GSTIN.
    expect(result.supplyType).toBe('intra');
    expect(result.cgst.paise).toBe(450000);
    expect(result.toArray().warnings).toEqual(result.warnings);
  });
});

describe('caller errors', () => {
  for (const gstRate of [17, 15, -5, 40]) {
    it(`refuses ${gstRate}%, which is not a notified slab`, () => {
      expect(() => invoice([line({ gstRate })])).toThrow(/Line 1 GST rate/);
    });
  }

  it('names the line that failed the slab check', () => {
    expect(() => invoice([line(), line({ gstRate: 17 })])).toThrow(/Line 2 GST rate/);
  });

  it('refuses an invoice with no lines', () => {
    expect(() => invoice([])).toThrow(InvalidInputError);
  });

  for (const [overrides, field] of [
    [{ description: '  ' }, 'Line 1 description'],
    [{ sac: '' }, 'Line 1 HSN or SAC'],
    [{ quantity: 0 }, 'Line 1 quantity'],
    [{ quantity: -1 }, 'Line 1 quantity'],
    [{ rate: 'free' }, 'Line 1 rate'],
    [{ rate: -100 }, 'Line 1 rate'],
    [{ discount: -1 }, 'Line 1 discount'],
  ] as Array<[Partial<InvoiceItemInput>, string]>) {
    it(`names the field on an unusable line: ${field}`, () => {
      expect(() => invoice([line(overrides)])).toThrow(field);
    });
  }

  for (const invoiceNumber of ['', 'INV-2025-000000001', 'INV#2025*0001']) {
    it(`refuses the invoice number "${invoiceNumber}", outside rule 46(b)`, () => {
      expect(() =>
        calculateInvoice({
          invoiceNumber,
          invoiceDate: INVOICE_DATE,
          sellerState: 'Karnataka',
          buyerState: 'Karnataka',
          items: [line()],
          asOf: INVOICE_DATE,
        }),
      ).toThrow(/Invoice number/);
    });
  }

  it('allows a slash inside the series, as rule 46(b) does', () => {
    const result = calculateInvoice({
      invoiceNumber: 'INV/2025-26/001',
      invoiceDate: INVOICE_DATE,
      sellerState: 'Karnataka',
      buyerState: 'Karnataka',
      items: [line()],
      asOf: INVOICE_DATE,
    });

    expect(result.invoiceNumber).toBe('INV/2025-26/001');
  });

  it('takes the statutory version from the invoice date rather than today', () => {
    // The day before GST came into force.
    expect(() =>
      calculateInvoice({
        invoiceNumber: 'INV-1',
        invoiceDate: '2017-06-30',
        sellerState: 'Karnataka',
        buyerState: 'Karnataka',
        items: [line()],
      }),
    ).toThrow(RateNotFoundError);
  });
});

describe('what the invoice hands on', () => {
  it('cites a statute on every step', () => {
    const result = invoice([line()], { buyerState: 'Maharashtra', reverseCharge: true });

    expect(result.workings.length).toBeGreaterThan(0);

    for (const step of result.workings) {
      expect(step.citation, `step "${step.label}" has no citation`).toBeTruthy();
    }

    expect(result.citations.length).toBeGreaterThan(0);
  });

  const words: Array<[number, string]> = [
    [50000, 'Rupees Fifty Nine Thousand Only'],
    [1000000, 'Rupees Eleven Lakh Eighty Thousand Only'],
    [0, 'Rupees Zero Only'],
  ];

  for (const [rate, expected] of words) {
    it(`writes the total in Indian units: ${expected}`, () => {
      const result = invoice([line({ rate, gstRate: rate === 0 ? 0 : 18 })], {
        buyerState: 'Maharashtra',
      });

      expect(result.amountInWords()).toBe(expected);
      expect(result.toArray().amount_in_words).toBe(expected);
    });
  }

  it('serialises the figures and the line breakdown', () => {
    const result = invoice([line({ quantity: 2, rate: 1000, discount: 200 })], {
      buyerState: 'Maharashtra',
      buyerGstin: VALID_GSTIN,
    });

    const data = result.toArray() as Record<string, never>;

    expect(data.supply_type).toBe('inter');
    expect(data.tax_head).toBe('IGST');
    expect(data.place_of_supply).toBe('Maharashtra (27)');
    expect(data.buyer_gstin).toBe(VALID_GSTIN);
    expect(data.invoice_date).toBe('2025-08-01');

    expect(data.taxable_total).toBe(1800);
    expect(data.taxable_total_formatted).toBe('₹1,800.00');
    expect(data.igst).toBe(324);
    expect(data.grand_total).toBe(2124);

    const lines = data.lines as unknown as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0].sac).toBe('998221');
    expect(lines[0].gross_value).toBe(2000);
    expect(lines[0].discount).toBe(200);
    expect(lines[0].taxable_value).toBe(1800);
    expect(lines[0].igst_formatted).toBe('₹324.00');

    // Rule 46's own checklist travels with the invoice, so a template has
    // something to check itself against.
    const particulars = data.mandatory_particulars as unknown as Array<{ clause: string }>;
    expect(particulars.length).toBeGreaterThan(0);
    expect(particulars[14].clause).toBe('46(o)');
  });

  it('names both states and the head the tax lands under', () => {
    const explanation = invoice([line()], { buyerState: 'Maharashtra' }).explain();

    expect(explanation).toContain('Karnataka (29) → Maharashtra (27)');
    expect(explanation).toContain('inter-state');
    expect(explanation).toContain('IGST ₹9,000.00');
  });

  it('is reachable under the name the single-tool package re-exports', () => {
    expect(invoiceAlias).toBe(calculateInvoice);
  });
});
