/* eslint-disable */
// prettier-ignore
/**
 * The statutory rate tables, embedded so the browser build carries its own data
 * and needs no PHP at runtime.
 *
 * Every amount below is in PAISE, exactly as the PHP package stores it. The
 * checksum is verified against the PHP tables on every build, so the two cannot
 * drift apart unnoticed.
 *
 * Tables:  bonus, compliance-calendar, epf, epfo-penalty, esi, gratuity, gst, income-tax, leave-encashment, professional-tax
 * SHA-256: e00c013be2bb7de8ea76c6cf6ea348034f71df95d0db18b79c309060a4a8adc4
 *
 * The checksum is sha256 over, for each table key in ascending order, the key
 * followed by a newline followed by the raw bytes of its JSON file. Reproduce it
 * in PHP with:
 *
 *   $digest = hash_init('sha256');
 *   foreach ($sortedKeys as $key) {
 *       hash_update($digest, $key."\n");
 *       hash_update($digest, file_get_contents($dir.'/'.$key.'.json'));
 *   }
 *   hash_final($digest);
 */

export const RATES_CHECKSUM = "e00c013be2bb7de8ea76c6cf6ea348034f71df95d0db18b79c309060a4a8adc4";

export const RATE_TABLE_KEYS = ["bonus","compliance-calendar","epf","epfo-penalty","esi","gratuity","gst","income-tax","leave-encashment","professional-tax"] as const;

export const RATE_TABLES: Record<string, RateTableDocument> = {
  "bonus": {
    "key": "bonus",
    "title": "Statutory bonus",
    "statute": "Payment of Bonus Act, 1965",
    "notes": [
      "Two distinct wage figures are involved and conflating them is the usual error. The ₹21,000 figure decides *whether* an employee is eligible. The ₹7,000 figure decides *what the bonus is computed on* - an employee earning ₹18,000 is eligible, but their bonus is calculated on ₹7,000, not ₹18,000.",
      "The calculation ceiling is ₹7,000 or the minimum wage notified for the scheduled employment, whichever is higher. Where a minimum wage is notified and exceeds ₹7,000, that figure governs.",
      "An employee must have worked at least 30 days in the accounting year to qualify.",
      "8.33% is the floor payable regardless of allocable surplus, and 20% the cap. Anything between depends on the available surplus computed under the Act's schedules.",
      "Bonus is payable within eight months of the close of the accounting year."
    ],
    "versions": [
      {
        "effective_from": "2014-04-01",
        "effective_to": null,
        "source": "Payment of Bonus (Amendment) Act 2015, given retrospective effect from 01-04-2014 - eligibility limit ₹21,000, calculation ceiling ₹7,000 or the notified minimum wage",
        "values": {
          "minimum_rate": 8.33,
          "maximum_rate": 20,
          "eligibility_wage_limit": 2100000,
          "calculation_ceiling": 700000,
          "calculation_ceiling_uses_minimum_wage": true,
          "minimum_working_days": 30,
          "months_in_year": 12,
          "payable_within_months": 8,
          "new_establishment_exemption_years": 5
        }
      },
      {
        "effective_from": "2006-11-01",
        "effective_to": "2014-03-31",
        "source": "Payment of Bonus (Amendment) Act 2007 - eligibility limit ₹10,000, calculation ceiling ₹3,500",
        "values": {
          "minimum_rate": 8.33,
          "maximum_rate": 20,
          "eligibility_wage_limit": 1000000,
          "calculation_ceiling": 350000,
          "calculation_ceiling_uses_minimum_wage": false,
          "minimum_working_days": 30,
          "months_in_year": 12,
          "payable_within_months": 8,
          "new_establishment_exemption_years": 5
        }
      }
    ],
    "_units": "Monetary values are in paise. ₹21,000 is 2100000; ₹7,000 is 700000."
  },
  "compliance-calendar": {
    "key": "compliance-calendar",
    "title": "Statutory due dates for Indian payroll",
    "statute": "Various - see each obligation's source",
    "notes": [
      "Dates are expressed as recurrence rules rather than a fixed list, so a calendar can be generated for any financial year.",
      "`day` is the day of the month the obligation falls due. `month_offset` is how many months after the period it relates to: 1 means the month following the wage month.",
      "Where a due date falls on a Sunday or a gazetted holiday, most portals accept the next working day, but the statutory date is what is recorded here. Callers that need working-day adjustment should apply their own holiday calendar.",
      "GST return dates assume monthly filing. Taxpayers under the QRMP scheme follow the quarterly variants noted on each entry."
    ],
    "versions": [
      {
        "effective_from": "2025-04-01",
        "effective_to": null,
        "source": "EPF Scheme 1952 para 38; ESI (General) Regulations 1950 reg. 31; Income-tax Rules 1962 rules 30, 31A and 31; CGST Rules 2017",
        "values": {
          "obligations": [
            {
              "code": "PF_ECR",
              "title": "EPF contribution payment and ECR filing",
              "authority": "EPFO",
              "frequency": "monthly",
              "day": 15,
              "month_offset": 1,
              "source": "Para 38 of the EPF Scheme 1952",
              "penalty": "Interest at 12% per annum under section 7Q plus damages under section 14B"
            },
            {
              "code": "ESI_PAY",
              "title": "ESI contribution payment",
              "authority": "ESIC",
              "frequency": "monthly",
              "day": 15,
              "month_offset": 1,
              "source": "Regulation 31 of the ESI (General) Regulations 1950",
              "penalty": "Simple interest at 12% per annum plus damages up to 25% under regulation 31C"
            },
            {
              "code": "TDS_PAY",
              "title": "TDS deposit for the preceding month",
              "authority": "Income Tax Department",
              "frequency": "monthly",
              "day": 7,
              "month_offset": 1,
              "source": "Rule 30 of the Income-tax Rules 1962",
              "exceptions": [
                {
                  "applies_to_month": 3,
                  "day": 30,
                  "month_offset": 1,
                  "note": "TDS for March is due by 30 April, not 7 April."
                }
              ],
              "penalty": "Interest at 1% per month for late deduction and 1.5% per month for late deposit under section 201(1A)"
            },
            {
              "code": "TDS_RETURN_24Q",
              "title": "Quarterly TDS return on salary (Form 24Q)",
              "authority": "Income Tax Department",
              "frequency": "quarterly",
              "source": "Rule 31A of the Income-tax Rules 1962",
              "quarters": [
                {
                  "quarter": 1,
                  "period": "April to June",
                  "due": "07-31"
                },
                {
                  "quarter": 2,
                  "period": "July to September",
                  "due": "10-31"
                },
                {
                  "quarter": 3,
                  "period": "October to December",
                  "due": "01-31"
                },
                {
                  "quarter": 4,
                  "period": "January to March",
                  "due": "05-31"
                }
              ],
              "penalty": "₹200 per day under section 234E, capped at the TDS amount, plus penalty under section 271H"
            },
            {
              "code": "FORM_16",
              "title": "Issue Form 16 to employees",
              "authority": "Income Tax Department",
              "frequency": "annual",
              "due": "06-15",
              "source": "Rule 31(3) of the Income-tax Rules 1962",
              "penalty": "₹100 per day per certificate under section 272A(2)(g)"
            },
            {
              "code": "GSTR_1",
              "title": "GSTR-1 outward supplies return",
              "authority": "GSTN",
              "frequency": "monthly",
              "day": 11,
              "month_offset": 1,
              "source": "Rule 59 of the CGST Rules 2017",
              "qrmp_variant": {
                "frequency": "quarterly",
                "day": 13,
                "month_offset": 1
              },
              "penalty": "Late fee of ₹50 per day, ₹20 for nil returns"
            },
            {
              "code": "GSTR_3B",
              "title": "GSTR-3B summary return and tax payment",
              "authority": "GSTN",
              "frequency": "monthly",
              "day": 20,
              "month_offset": 1,
              "source": "Rule 61 of the CGST Rules 2017",
              "qrmp_variant": {
                "frequency": "quarterly",
                "day": 22,
                "month_offset": 1,
                "note": "22nd or 24th depending on the state group"
              },
              "penalty": "Late fee plus interest at 18% per annum on tax paid late"
            },
            {
              "code": "PT_PAY",
              "title": "Professional tax payment",
              "authority": "State commercial tax department",
              "frequency": "monthly",
              "day": 20,
              "month_offset": 1,
              "source": "Varies by state enactment",
              "note": "The day differs by state - Karnataka the 20th, Maharashtra the last day, West Bengal the 21st. Callers should override from the state schedule where precision matters."
            },
            {
              "code": "ADVANCE_TAX",
              "title": "Advance tax instalment",
              "authority": "Income Tax Department",
              "frequency": "quarterly",
              "source": "Section 211 of the Income-tax Act 1961",
              "instalments": [
                {
                  "due": "06-15",
                  "cumulative_percent": 15
                },
                {
                  "due": "09-15",
                  "cumulative_percent": 45
                },
                {
                  "due": "12-15",
                  "cumulative_percent": 75
                },
                {
                  "due": "03-15",
                  "cumulative_percent": 100
                }
              ],
              "penalty": "Interest under sections 234B and 234C"
            },
            {
              "code": "ITR_NON_AUDIT",
              "title": "Income tax return, non-audit cases",
              "authority": "Income Tax Department",
              "frequency": "annual",
              "due": "07-31",
              "source": "Section 139(1) of the Income-tax Act 1961",
              "penalty": "Late filing fee up to ₹5,000 under section 234F"
            },
            {
              "code": "ITR_AUDIT",
              "title": "Income tax return, audit cases",
              "authority": "Income Tax Department",
              "frequency": "annual",
              "due": "10-31",
              "source": "Section 139(1) of the Income-tax Act 1961"
            },
            {
              "code": "TAX_AUDIT",
              "title": "Tax audit report (Form 3CA/3CB and 3CD)",
              "authority": "Income Tax Department",
              "frequency": "annual",
              "due": "09-30",
              "source": "Section 44AB of the Income-tax Act 1961"
            },
            {
              "code": "LWF",
              "title": "Labour Welfare Fund contribution",
              "authority": "State labour welfare board",
              "frequency": "varies",
              "source": "State Labour Welfare Fund Acts",
              "note": "Frequency and dates vary widely - Karnataka annually by 15 January, Maharashtra half-yearly by 15 July and 15 January, Tamil Nadu annually by 31 January. Not all states levy it."
            }
          ]
        }
      }
    ]
  },
  "epf": {
    "key": "epf",
    "title": "Employees' Provident Fund, Pension Scheme and EDLI",
    "statute": "Employees' Provident Funds and Miscellaneous Provisions Act, 1952",
    "notes": [
      "PF wages mean basic wages plus dearness allowance plus retaining allowance. Following Vivekananda Vidyamandir (SC, 28 Feb 2019), allowances paid ordinarily and uniformly to all employees form part of basic wages.",
      "The employer's total share is 12%. The EPS slice is 8.33% of wages but is capped at 8.33% of the statutory ceiling; whatever remains of the 12% goes to EPF. This asymmetry is the single most commonly mis-implemented rule in Indian payroll.",
      "EPS membership is closed to employees who first join on or after 01-09-2014 earning above the ceiling, and ceases at age 58. In both cases the entire employer share goes to EPF."
    ],
    "versions": [
      {
        "effective_from": "2014-09-01",
        "effective_to": null,
        "source": "S.O. 2882(E) dated 22-08-2014 (ceiling raised to ₹15,000); EPF Scheme 1952 paras 26A, 29, 60; EPS 1995 para 3; EDLI 1976 para 7",
        "values": {
          "wage_ceiling": 1500000,
          "employee_rate": 12,
          "employer_rate": 12,
          "eps_rate": 8.33,
          "eps_ceiling_wage": 1500000,
          "eps_max_contribution": 125000,
          "eps_max_age": 58,
          "edli_rate": 0.5,
          "edli_ceiling_wage": 1500000,
          "edli_max_contribution": 7500,
          "admin_charges_rate": 0.5,
          "admin_charges_minimum": 50000,
          "admin_charges_minimum_non_contributing": 7500,
          "edli_admin_charges_rate": 0,
          "reduced_rate": 10,
          "reduced_rate_applies_to": [
            "Establishments with fewer than 20 employees",
            "Sick industrial companies declared by BIFR",
            "Establishments with accumulated losses exceeding net worth",
            "Jute, beedi, brick, coir and guar gum industries"
          ],
          "interest_rate_by_year": {
            "2021-22": 8.1,
            "2022-23": 8.15,
            "2023-24": 8.25,
            "2024-25": 8.25,
            "2025-26": 8.25
          }
        }
      },
      {
        "effective_from": "2001-06-01",
        "effective_to": "2014-08-31",
        "source": "S.O. 320 dated 24-05-2001 (ceiling raised to ₹6,500)",
        "values": {
          "wage_ceiling": 650000,
          "employee_rate": 12,
          "employer_rate": 12,
          "eps_rate": 8.33,
          "eps_ceiling_wage": 650000,
          "eps_max_contribution": 54145,
          "eps_max_age": 58,
          "edli_rate": 0.5,
          "edli_ceiling_wage": 650000,
          "edli_max_contribution": 3250,
          "admin_charges_rate": 1.1,
          "admin_charges_minimum": 0,
          "admin_charges_minimum_non_contributing": 0,
          "edli_admin_charges_rate": 0.01,
          "reduced_rate": 10,
          "reduced_rate_applies_to": [],
          "interest_rate_by_year": {}
        }
      }
    ],
    "_units": "All monetary values are in paise. ₹15,000 is 1500000."
  },
  "epfo-penalty": {
    "key": "epfo-penalty",
    "title": "EPFO interest and damages on delayed remittance",
    "statute": "EPF & MP Act 1952, sections 7Q (interest) and 14B (damages)",
    "notes": [
      "Interest under 7Q and damages under 14B are cumulative, not alternatives. An employer in default pays both.",
      "Interest under 7Q runs at 12% per annum simple, from the date the contribution fell due to the date of actual payment.",
      "Damages under 14B were restructured with effect from 14 June 2024 to a flat 1% per month of delay, replacing the earlier slab scale that rose with the length of the default. Calculations for periods before that date must use the old slabs.",
      "Damages cannot exceed the amount of arrears - section 14B's proviso caps them at 100% of the contribution in default.",
      "Contributions fall due on the 15th of the month following the wage month."
    ],
    "versions": [
      {
        "effective_from": "2024-06-14",
        "effective_to": null,
        "source": "G.S.R. 328(E) dated 14-06-2024 amending para 32A of the EPF Scheme 1952 - uniform 1% per month of delay",
        "values": {
          "interest_rate_per_annum": 12,
          "damages_basis": "flat_per_month",
          "damages_rate_per_month": 1,
          "damages_slabs": [],
          "damages_capped_at_arrears": true,
          "due_day_of_following_month": 15,
          "applies_to_schemes": [
            "EPF",
            "EPS",
            "EDLI"
          ]
        }
      },
      {
        "effective_from": "2008-09-26",
        "effective_to": "2024-06-13",
        "source": "Para 32A of the EPF Scheme 1952 as it stood before G.S.R. 328(E) - slab scale of damages by length of default",
        "values": {
          "interest_rate_per_annum": 12,
          "damages_basis": "slab_per_annum",
          "damages_rate_per_month": null,
          "damages_slabs": [
            {
              "months_from": 0,
              "months_to": 2,
              "rate_per_annum": 5
            },
            {
              "months_from": 2,
              "months_to": 4,
              "rate_per_annum": 10
            },
            {
              "months_from": 4,
              "months_to": 6,
              "rate_per_annum": 15
            },
            {
              "months_from": 6,
              "months_to": null,
              "rate_per_annum": 25
            }
          ],
          "damages_capped_at_arrears": true,
          "due_day_of_following_month": 15,
          "applies_to_schemes": [
            "EPF",
            "EPS",
            "EDLI"
          ]
        }
      }
    ],
    "_units": "Rates are percentages. Monetary values, where present, are in paise."
  },
  "esi": {
    "key": "esi",
    "title": "Employees' State Insurance",
    "statute": "Employees' State Insurance Act, 1948",
    "notes": [
      "Wages for ESI are gross wages, a far wider base than PF wages: it includes most allowances but excludes annual bonus, gratuity, and any payment made at intervals exceeding two months.",
      "The contribution-period rule catches people out. Contribution periods run April-September and October-March. If an employee's wages rise above the limit mid-period, contributions continue on the higher wages until the end of that period, and coverage ceases only from the start of the next one.",
      "An employee whose average daily wage does not exceed the exemption threshold pays no employee share, but the employer still pays its 3.25%.",
      "Both shares are rounded up to the next whole rupee individually, not on the total."
    ],
    "versions": [
      {
        "effective_from": "2019-07-01",
        "effective_to": null,
        "source": "G.S.R. 423(E) dated 13-06-2019 (rates cut to 0.75% / 3.25%); ESI (Central) Rules 1950, rules 50, 51, 51B",
        "values": {
          "employee_rate": 0.75,
          "employer_rate": 3.25,
          "wage_limit": 2100000,
          "wage_limit_disabled": 2500000,
          "daily_wage_exemption_limit": 17600,
          "contribution_periods": [
            {
              "name": "First",
              "from": "04-01",
              "to": "09-30",
              "benefit_period": "01-01 to 06-30 of the following year"
            },
            {
              "name": "Second",
              "from": "10-01",
              "to": "03-31",
              "benefit_period": "07-01 to 12-31 of the following year"
            }
          ],
          "rounding": "up_to_rupee",
          "employer_pays_when_employee_exempt": true
        }
      },
      {
        "effective_from": "2017-01-01",
        "effective_to": "2019-06-30",
        "source": "G.S.R. 1224(E) dated 22-12-2016 (wage limit raised to ₹21,000)",
        "values": {
          "employee_rate": 1.75,
          "employer_rate": 4.75,
          "wage_limit": 2100000,
          "wage_limit_disabled": 2500000,
          "daily_wage_exemption_limit": 13700,
          "contribution_periods": [
            {
              "name": "First",
              "from": "04-01",
              "to": "09-30",
              "benefit_period": "01-01 to 06-30 of the following year"
            },
            {
              "name": "Second",
              "from": "10-01",
              "to": "03-31",
              "benefit_period": "07-01 to 12-31 of the following year"
            }
          ],
          "rounding": "up_to_rupee",
          "employer_pays_when_employee_exempt": true
        }
      }
    ],
    "_units": "All monetary values are in paise. ₹21,000 is 2100000."
  },
  "gratuity": {
    "key": "gratuity",
    "title": "Gratuity",
    "statute": "Payment of Gratuity Act, 1972",
    "notes": [
      "Salary for gratuity means last drawn basic wages plus dearness allowance. It does not include HRA, bonus, overtime or other allowances.",
      "The divisor 26 represents working days in a month, on the footing that four Sundays are not paid working days. Establishments outside the Act's coverage conventionally use 30 instead, and there is no six-month rounding for them.",
      "The six-month rule rounds a part year up only when the excess is more than six months. Seven years and six months is seven years; seven years and seven months is eight.",
      "The five-year qualifying period is waived where employment ends on death or disablement. In Madras High Court's reading (Mettur Beardsell), 240 days in the fifth year suffices as continuous service for that year.",
      "The ₹20 lakh figure is the section 10(10) tax exemption ceiling for non-government employees, applied cumulatively across an employee's lifetime. An employer may contractually pay more; the excess is taxable."
    ],
    "versions": [
      {
        "effective_from": "2018-03-29",
        "effective_to": null,
        "source": "Payment of Gratuity (Amendment) Act 2018 and S.O. 1420(E) dated 29-03-2018 raising the ceiling to ₹20,00,000",
        "values": {
          "covered_divisor": 26,
          "covered_multiplier": 15,
          "non_covered_divisor": 30,
          "non_covered_multiplier": 15,
          "minimum_years_of_service": 5,
          "minimum_waived_on": [
            "death",
            "disablement"
          ],
          "round_up_after_months": 6,
          "round_up_applies_to_non_covered": false,
          "tax_exemption_limit": 200000000,
          "employee_threshold_for_coverage": 10,
          "seasonal_establishment_days": 7
        }
      },
      {
        "effective_from": "2010-05-24",
        "effective_to": "2018-03-28",
        "source": "Payment of Gratuity (Amendment) Act 2010 raising the ceiling to ₹10,00,000",
        "values": {
          "covered_divisor": 26,
          "covered_multiplier": 15,
          "non_covered_divisor": 30,
          "non_covered_multiplier": 15,
          "minimum_years_of_service": 5,
          "minimum_waived_on": [
            "death",
            "disablement"
          ],
          "round_up_after_months": 6,
          "round_up_applies_to_non_covered": false,
          "tax_exemption_limit": 100000000,
          "employee_threshold_for_coverage": 10,
          "seasonal_establishment_days": 7
        }
      }
    ],
    "_units": "Monetary values are in paise. ₹20,00,000 is 200000000."
  },
  "gst": {
    "key": "gst",
    "title": "Goods and services tax on a tax invoice",
    "statute": "Central Goods and Services Tax Act 2017, Integrated Goods and Services Tax Act 2017 and the Central Goods and Services Tax Rules 2017",
    "notes": [
      "The tax head is decided by the place of supply, never by preference or by a per-customer setting. Where the supplier's state and the place of supply are the same state the tax splits into central and state halves at half the notified rate each; where they differ the whole of it is integrated tax at the full rate. Charging CGST plus SGST on an inter-state supply files the money with a state that is not entitled to it and leaves the recipient unable to take credit.",
      "The slab list is the rate *structure* in force, not the classification of any particular supply. Which slab a given HSN or SAC attracts comes from the rate notifications and the Council's periodic revisions, and has to be taken from those; this table only says which rates a tax invoice may lawfully carry.",
      "The state codes are the first two digits of every GSTIN, which is what makes a GSTIN worth validating: it carries the registered person's state inside it. Note that the place of supply need not equal the recipient's state of registration - a Karnataka-registered buyer can take delivery in Tamil Nadu - so a mismatch between the two is worth flagging but is not by itself an error.",
      "GSTIN checksums are MOD-36 over the first fourteen characters, with alternating weights of 1 and 2 and both digits of each product added into the sum. The fourteenth character is a fixed 'Z' for a normal registration; other letters there belong to UIN and OIDAR-style registrations that this table does not cover.",
      "Section 170 requires the tax and the amount payable to be rounded to the nearest rupee. The round-off is shown as its own line rather than absorbed into a total, because the recipient's books have to reconcile the credit they claim against the tax charged and a silently dropped forty paise breaks that reconciliation.",
      "Where tax is payable on reverse charge the supplier still computes and discloses it, but does not collect it: the invoice total excludes it and carries the declaration required by rule 46(o). Section 31(3)(f) then obliges the recipient to raise their own invoice for the inward supply."
    ],
    "verification_status": "Compiled from the CGST/IGST Acts and the CGST Rules as at FY 2025-26. Rate classifications for individual supplies change with every Council meeting and are deliberately not carried here. Community corrections welcome - open a 'Statutory rate change' issue with the notification.",
    "versions": [
      {
        "effective_from": "2017-07-01",
        "effective_to": null,
        "source": "GST rollout on 01-07-2017: notification 3/2017-Central Tax dated 19-06-2017 notifying the CGST Rules, and notifications 1/2017 to 11/2017-Central Tax (Rate) dated 28-06-2017 establishing the 5, 12, 18 and 28 per cent slabs alongside nil-rated supply",
        "values": {
          "slabs": [
            0,
            5,
            12,
            18,
            28
          ],
          "intra_state_heads": [
            "cgst",
            "sgst"
          ],
          "inter_state_heads": [
            "igst"
          ],
          "intra_state_divisor": 2,
          "round_off_to": 100,
          "invoice_number_max_length": 16,
          "invoice_number_pattern": "^[A-Za-z0-9/-]{1,16}$",
          "unregistered_recipient_address_threshold": 5000000,
          "reverse_charge_declaration": "Tax payable on reverse charge basis. The recipient is liable to pay the tax shown on this invoice; it is not collected by the supplier.",
          "gstin": {
            "length": 15,
            "pattern": "^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$",
            "checksum": "mod-36",
            "checksum_charset": "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
            "checksum_over_characters": 14,
            "fourteenth_character": "Z"
          },
          "citations": {
            "place_of_supply": "IGST Act 2017, sections 7 and 8 read with sections 10 and 12 - whether a supply is inter-State or intra-State",
            "intra_state_levy": "CGST Act 2017, section 9(1) and the corresponding section 9(1) of the State GST Act - central tax and State tax at half the notified rate each",
            "inter_state_levy": "IGST Act 2017, section 5(1) - integrated tax at the full notified rate",
            "value_of_supply": "CGST Act 2017, section 15, including section 15(3)(a) under which a discount given at the time of supply and shown on the invoice is excluded from the value",
            "rate_of_tax": "CGST Act 2017, section 9(1) and IGST Act 2017, section 5(1), read with the rate notifications issued under them",
            "rounding": "CGST Act 2017, section 170 - the amount of tax and the amount payable are rounded to the nearest rupee",
            "reverse_charge": "CGST Act 2017, sections 9(3) and 9(4) and IGST Act 2017, sections 5(3) and 5(4), with the declaration required by CGST Rules 2017, rule 46(o)",
            "invoice_particulars": "CGST Act 2017, section 31 read with CGST Rules 2017, rules 46 and 47",
            "gstin": "CGST Act 2017, section 25(9) and 25(10) read with CGST Rules 2017, rule 10 - the fifteen-character registration number"
          },
          "state_codes": {
            "10": "Bihar",
            "11": "Sikkim",
            "12": "Arunachal Pradesh",
            "13": "Nagaland",
            "14": "Manipur",
            "15": "Mizoram",
            "16": "Tripura",
            "17": "Meghalaya",
            "18": "Assam",
            "19": "West Bengal",
            "20": "Jharkhand",
            "21": "Odisha",
            "22": "Chhattisgarh",
            "23": "Madhya Pradesh",
            "24": "Gujarat",
            "25": "Daman and Diu",
            "26": "Dadra and Nagar Haveli and Daman and Diu",
            "27": "Maharashtra",
            "28": "Andhra Pradesh (before bifurcation)",
            "29": "Karnataka",
            "30": "Goa",
            "31": "Lakshadweep",
            "32": "Kerala",
            "33": "Tamil Nadu",
            "34": "Puducherry",
            "35": "Andaman and Nicobar Islands",
            "36": "Telangana",
            "37": "Andhra Pradesh",
            "38": "Ladakh",
            "97": "Other Territory",
            "99": "Centre Jurisdiction",
            "01": "Jammu and Kashmir",
            "02": "Himachal Pradesh",
            "03": "Punjab",
            "04": "Chandigarh",
            "05": "Uttarakhand",
            "06": "Haryana",
            "07": "Delhi",
            "08": "Rajasthan",
            "09": "Uttar Pradesh"
          },
          "invoice_particulars": [
            {
              "clause": "46(a)",
              "particular": "Name, address and GSTIN of the supplier"
            },
            {
              "clause": "46(b)",
              "particular": "A consecutive serial number not exceeding sixteen characters, unique for a financial year, containing only alphabets, numerals, hyphen and slash"
            },
            {
              "clause": "46(c)",
              "particular": "Date of issue"
            },
            {
              "clause": "46(d)",
              "particular": "Name, address and GSTIN or UIN of the recipient, if registered"
            },
            {
              "clause": "46(e)",
              "particular": "Name and address of an unregistered recipient, the address of delivery, and the State and its code, where the taxable value is ₹50,000 or more"
            },
            {
              "clause": "46(f)",
              "particular": "HSN code for goods, or SAC for services"
            },
            {
              "clause": "46(g)",
              "particular": "Description of the goods or services"
            },
            {
              "clause": "46(h)",
              "particular": "Quantity, and the unit or Unique Quantity Code, in the case of goods"
            },
            {
              "clause": "46(i)",
              "particular": "Total value of the supply"
            },
            {
              "clause": "46(j)",
              "particular": "Taxable value of the supply, after any discount or abatement"
            },
            {
              "clause": "46(k)",
              "particular": "Rate of tax under each head - central tax, State tax, integrated tax, Union territory tax or cess"
            },
            {
              "clause": "46(l)",
              "particular": "Amount of tax charged under each head"
            },
            {
              "clause": "46(m)",
              "particular": "Place of supply with the name of the State, on an inter-State supply"
            },
            {
              "clause": "46(n)",
              "particular": "Address of delivery where it differs from the place of supply"
            },
            {
              "clause": "46(o)",
              "particular": "Whether the tax is payable on reverse charge basis"
            },
            {
              "clause": "46(p)",
              "particular": "Signature or digital signature of the supplier or an authorised representative"
            }
          ]
        }
      }
    ],
    "_units": "Monetary values are in paise. The rule 46(e) threshold of ₹50,000 is 5000000, and round_off_to of 100 paise is one rupee. Slab and GST rates are percentages, not paise."
  },
  "income-tax": {
    "key": "income-tax",
    "title": "Income tax on salary - new and old regime",
    "statute": "Income-tax Act, 1961; section 115BAC for the new regime",
    "notes": [
      "The new regime is the default under section 115BAC(1A). A salaried employee may opt out for a given year; the old regime is not the fallback unless opted for.",
      "The section 87A rebate has a marginal relief band that a naive slab loop gets wrong. Just above the rebate threshold, tax is limited to the amount by which total income exceeds that threshold - so at ₹12,10,000 of income the tax is ₹10,000, not the ₹61,500 the slabs alone would give.",
      "Surcharge also carries marginal relief at each threshold: the additional tax plus surcharge cannot exceed the additional income above the threshold.",
      "The 37% surcharge slab does not exist in the new regime; it is capped at 25%.",
      "Health and education cess is 4%, applied to tax plus surcharge.",
      "Final tax payable is rounded to the nearest ₹10 under section 288B.",
      "The newest version is deliberately left open-ended rather than expiring on 31 March. Income tax slabs are revised most years, so an end date creates a cliff: the day the financial year turns over, every calculator called without an explicit date throws instead of computing. Carrying the last known slabs forward is the lesser evil, but it is still an assumption - RateTable::isProvisionalFor() reports when the resolved version's financial year does not match the requested date, and calculators surface that as a warning on the result. Add a dated version for the new financial year as soon as the Finance Act is notified, and the warning disappears."
    ],
    "versions": [
      {
        "effective_from": "2025-04-01",
        "effective_to": null,
        "financial_year": "2025-26",
        "assessment_year": "2026-27",
        "source": "Finance Act 2025 - new regime slabs revised, standard deduction ₹75,000, section 87A rebate raised to ₹60,000 for total income up to ₹12,00,000",
        "values": {
          "new_regime": {
            "slabs": [
              {
                "from": 0,
                "to": 40000000,
                "rate": 0
              },
              {
                "from": 40000000,
                "to": 80000000,
                "rate": 5
              },
              {
                "from": 80000000,
                "to": 120000000,
                "rate": 10
              },
              {
                "from": 120000000,
                "to": 160000000,
                "rate": 15
              },
              {
                "from": 160000000,
                "to": 200000000,
                "rate": 20
              },
              {
                "from": 200000000,
                "to": 240000000,
                "rate": 25
              },
              {
                "from": 240000000,
                "to": null,
                "rate": 30
              }
            ],
            "standard_deduction": 7500000,
            "rebate_87a": {
              "max_rebate": 6000000,
              "income_limit": 120000000,
              "marginal_relief": true
            },
            "surcharge": [
              {
                "above": 500000000,
                "rate": 10
              },
              {
                "above": 1000000000,
                "rate": 15
              },
              {
                "above": 2000000000,
                "rate": 25
              }
            ],
            "cess_rate": 4,
            "allowed_deductions": [
              "Standard deduction under section 16(ia)",
              "Employer's NPS contribution under section 80CCD(2), up to 14% of salary",
              "Contribution to the Agniveer Corpus Fund under section 80CCH",
              "Transport allowance for an employee with a disability",
              "Conveyance allowance incurred in the performance of duty"
            ],
            "disallowed_deductions": [
              "Section 80C",
              "Section 80D",
              "House rent allowance exemption under section 10(13A)",
              "Leave travel allowance under section 10(5)",
              "Interest on a self-occupied house property under section 24(b)"
            ]
          },
          "old_regime": {
            "slabs_by_age": {
              "below_60": [
                {
                  "from": 0,
                  "to": 25000000,
                  "rate": 0
                },
                {
                  "from": 25000000,
                  "to": 50000000,
                  "rate": 5
                },
                {
                  "from": 50000000,
                  "to": 100000000,
                  "rate": 20
                },
                {
                  "from": 100000000,
                  "to": null,
                  "rate": 30
                }
              ],
              "senior_60_to_80": [
                {
                  "from": 0,
                  "to": 30000000,
                  "rate": 0
                },
                {
                  "from": 30000000,
                  "to": 50000000,
                  "rate": 5
                },
                {
                  "from": 50000000,
                  "to": 100000000,
                  "rate": 20
                },
                {
                  "from": 100000000,
                  "to": null,
                  "rate": 30
                }
              ],
              "super_senior_80_plus": [
                {
                  "from": 0,
                  "to": 50000000,
                  "rate": 0
                },
                {
                  "from": 50000000,
                  "to": 100000000,
                  "rate": 20
                },
                {
                  "from": 100000000,
                  "to": null,
                  "rate": 30
                }
              ]
            },
            "standard_deduction": 5000000,
            "rebate_87a": {
              "max_rebate": 1250000,
              "income_limit": 50000000,
              "marginal_relief": false
            },
            "surcharge": [
              {
                "above": 500000000,
                "rate": 10
              },
              {
                "above": 1000000000,
                "rate": 15
              },
              {
                "above": 2000000000,
                "rate": 25
              },
              {
                "above": 5000000000,
                "rate": 37
              }
            ],
            "cess_rate": 4,
            "deduction_limits": {
              "80c": 15000000,
              "80ccd_1b": 5000000,
              "80ccd_2_percent_of_salary": 10,
              "80d_self_below_60": 2500000,
              "80d_self_60_plus": 5000000,
              "80d_parents_below_60": 2500000,
              "80d_parents_60_plus": 5000000,
              "80tta": 1000000,
              "80ttb": 5000000,
              "24b_self_occupied": 20000000,
              "80e": null,
              "80g_varies": true
            },
            "hra_exemption": {
              "metro_percent": 50,
              "non_metro_percent": 40,
              "rent_less_percent_of_salary": 10,
              "metro_cities": [
                "Delhi",
                "Mumbai",
                "Kolkata",
                "Chennai"
              ],
              "note": "Least of: actual HRA received; the metro or non-metro percentage of salary; rent paid less 10% of salary. Salary here means basic plus DA forming part of retirement benefits plus commission on turnover."
            }
          },
          "rounding": {
            "final_tax": "nearest_ten_rupees",
            "citation": "Section 288B"
          }
        }
      },
      {
        "effective_from": "2024-04-01",
        "effective_to": "2025-03-31",
        "financial_year": "2024-25",
        "assessment_year": "2025-26",
        "source": "Finance (No. 2) Act 2024 - new regime slabs revised, standard deduction raised to ₹75,000",
        "values": {
          "new_regime": {
            "slabs": [
              {
                "from": 0,
                "to": 30000000,
                "rate": 0
              },
              {
                "from": 30000000,
                "to": 70000000,
                "rate": 5
              },
              {
                "from": 70000000,
                "to": 100000000,
                "rate": 10
              },
              {
                "from": 100000000,
                "to": 120000000,
                "rate": 15
              },
              {
                "from": 120000000,
                "to": 150000000,
                "rate": 20
              },
              {
                "from": 150000000,
                "to": null,
                "rate": 30
              }
            ],
            "standard_deduction": 7500000,
            "rebate_87a": {
              "max_rebate": 2500000,
              "income_limit": 70000000,
              "marginal_relief": true
            },
            "surcharge": [
              {
                "above": 500000000,
                "rate": 10
              },
              {
                "above": 1000000000,
                "rate": 15
              },
              {
                "above": 2000000000,
                "rate": 25
              }
            ],
            "cess_rate": 4,
            "allowed_deductions": [],
            "disallowed_deductions": []
          },
          "old_regime": {
            "slabs_by_age": {
              "below_60": [
                {
                  "from": 0,
                  "to": 25000000,
                  "rate": 0
                },
                {
                  "from": 25000000,
                  "to": 50000000,
                  "rate": 5
                },
                {
                  "from": 50000000,
                  "to": 100000000,
                  "rate": 20
                },
                {
                  "from": 100000000,
                  "to": null,
                  "rate": 30
                }
              ],
              "senior_60_to_80": [
                {
                  "from": 0,
                  "to": 30000000,
                  "rate": 0
                },
                {
                  "from": 30000000,
                  "to": 50000000,
                  "rate": 5
                },
                {
                  "from": 50000000,
                  "to": 100000000,
                  "rate": 20
                },
                {
                  "from": 100000000,
                  "to": null,
                  "rate": 30
                }
              ],
              "super_senior_80_plus": [
                {
                  "from": 0,
                  "to": 50000000,
                  "rate": 0
                },
                {
                  "from": 50000000,
                  "to": 100000000,
                  "rate": 20
                },
                {
                  "from": 100000000,
                  "to": null,
                  "rate": 30
                }
              ]
            },
            "standard_deduction": 5000000,
            "rebate_87a": {
              "max_rebate": 1250000,
              "income_limit": 50000000,
              "marginal_relief": false
            },
            "surcharge": [
              {
                "above": 500000000,
                "rate": 10
              },
              {
                "above": 1000000000,
                "rate": 15
              },
              {
                "above": 2000000000,
                "rate": 25
              },
              {
                "above": 5000000000,
                "rate": 37
              }
            ],
            "cess_rate": 4,
            "deduction_limits": {
              "80c": 15000000,
              "80ccd_1b": 5000000,
              "80ccd_2_percent_of_salary": 10,
              "80d_self_below_60": 2500000,
              "80d_self_60_plus": 5000000,
              "80d_parents_below_60": 2500000,
              "80d_parents_60_plus": 5000000,
              "80tta": 1000000,
              "80ttb": 5000000,
              "24b_self_occupied": 20000000
            },
            "hra_exemption": {
              "metro_percent": 50,
              "non_metro_percent": 40,
              "rent_less_percent_of_salary": 10,
              "metro_cities": [
                "Delhi",
                "Mumbai",
                "Kolkata",
                "Chennai"
              ]
            }
          },
          "rounding": {
            "final_tax": "nearest_ten_rupees",
            "citation": "Section 288B"
          }
        }
      }
    ],
    "_units": "All monetary values are in paise. ₹4,00,000 is 40000000; ₹50,00,000 is 500000000."
  },
  "leave-encashment": {
    "key": "leave-encashment",
    "title": "Leave encashment on retirement or resignation",
    "statute": "Income-tax Act 1961, section 10(10AA)",
    "notes": [
      "Encashment received while still in service is fully taxable. The exemption applies only on retirement or resignation.",
      "Government employees are fully exempt under section 10(10AA)(i). The limits below apply to non-government employees under 10(10AA)(ii).",
      "The exemption is the least of four figures, and the fourth - cash equivalent of unavailed leave - is itself capped at 30 days of credit for each completed year of service, regardless of how generous the employer's leave policy is.",
      "The ₹25,00,000 ceiling is a lifetime aggregate across all employers, not per employment.",
      "Average salary means the average of the last ten months' basic pay plus dearness allowance forming part of retirement benefits plus commission computed as a fixed percentage of turnover."
    ],
    "versions": [
      {
        "effective_from": "2023-04-01",
        "effective_to": null,
        "source": "Notification 31/2023 dated 24-05-2023, raising the section 10(10AA)(ii) limit to ₹25,00,000 with effect from AY 2024-25",
        "values": {
          "exemption_limit": 250000000,
          "average_salary_months": 10,
          "max_leave_days_per_year": 30,
          "months_of_salary_exempt": 10,
          "government_employees_fully_exempt": true,
          "taxable_if_encashed_in_service": true
        }
      },
      {
        "effective_from": "2002-04-01",
        "effective_to": "2023-03-31",
        "source": "Notification S.O. 588(E) dated 31-05-2002, limit of ₹3,00,000",
        "values": {
          "exemption_limit": 30000000,
          "average_salary_months": 10,
          "max_leave_days_per_year": 30,
          "months_of_salary_exempt": 10,
          "government_employees_fully_exempt": true,
          "taxable_if_encashed_in_service": true
        }
      }
    ],
    "_units": "Monetary values are in paise. ₹25,00,000 is 250000000."
  },
  "professional-tax": {
    "key": "professional-tax",
    "title": "Professional tax by state",
    "statute": "State enactments under Article 276 of the Constitution",
    "notes": [
      "Professional tax is a state levy, so there is no national schedule. Article 276(2) caps the total at ₹2,500 per person per year, which every state schedule respects.",
      "Deduction frequency differs by state. Most deduct monthly; Tamil Nadu and Kerala assess half-yearly; Bihar and Jharkhand assess annually. The `frequency` field says which, and slab amounts are expressed in that state's own frequency.",
      "Several states levy a higher amount in one month of the year - Maharashtra in February, Madhya Pradesh and Odisha in the final month - so that the annual total reaches exactly ₹2,500. That is the `special_month` field.",
      "Maharashtra exempts women earning up to ₹25,000 a month entirely; the `gender_exemption` field carries that rule.",
      "Punjab's levy is a development tax, applicable only to persons liable to income tax, but functions as professional tax for payroll purposes.",
      "These schedules change with state budgets more often than central rates do. Verify against the state commercial tax department before relying on them for filing."
    ],
    "verification_status": "Compiled from state schedules current as at FY 2025-26. Community corrections welcome - open a 'Statutory rate change' issue with the state notification.",
    "versions": [
      {
        "effective_from": "2025-04-01",
        "effective_to": null,
        "source": "State professional tax schedules as at FY 2025-26",
        "values": {
          "annual_cap": 250000,
          "states": {
            "Karnataka": {
              "frequency": "monthly",
              "source": "Karnataka Tax on Professions, Trades, Callings and Employments Act 1976, as amended w.e.f. 01-04-2023",
              "slabs": [
                {
                  "from": 0,
                  "to": 2500000,
                  "amount": 0
                },
                {
                  "from": 2500000,
                  "to": null,
                  "amount": 20000
                }
              ]
            },
            "Maharashtra": {
              "frequency": "monthly",
              "source": "Maharashtra State Tax on Professions, Trades, Callings and Employments Act 1975; women's exemption raised to ₹25,000 w.e.f. 01-04-2023",
              "slabs": [
                {
                  "from": 0,
                  "to": 750000,
                  "amount": 0
                },
                {
                  "from": 750000,
                  "to": 1000000,
                  "amount": 17500
                },
                {
                  "from": 1000000,
                  "to": null,
                  "amount": 20000
                }
              ],
              "special_month": {
                "month": 2,
                "amount": 30000
              },
              "gender_exemption": {
                "gender": "female",
                "up_to": 2500000
              }
            },
            "West Bengal": {
              "frequency": "monthly",
              "source": "West Bengal State Tax on Professions, Trades, Callings and Employments Act 1979",
              "slabs": [
                {
                  "from": 0,
                  "to": 1000000,
                  "amount": 0
                },
                {
                  "from": 1000000,
                  "to": 1500000,
                  "amount": 11000
                },
                {
                  "from": 1500000,
                  "to": 2500000,
                  "amount": 13000
                },
                {
                  "from": 2500000,
                  "to": 4000000,
                  "amount": 15000
                },
                {
                  "from": 4000000,
                  "to": null,
                  "amount": 20000
                }
              ]
            },
            "Andhra Pradesh": {
              "frequency": "monthly",
              "source": "Andhra Pradesh Tax on Professions, Trades, Callings and Employments Act 1987",
              "slabs": [
                {
                  "from": 0,
                  "to": 1500000,
                  "amount": 0
                },
                {
                  "from": 1500000,
                  "to": 2000000,
                  "amount": 15000
                },
                {
                  "from": 2000000,
                  "to": null,
                  "amount": 20000
                }
              ]
            },
            "Telangana": {
              "frequency": "monthly",
              "source": "Telangana Tax on Professions, Trades, Callings and Employments Act 1987",
              "slabs": [
                {
                  "from": 0,
                  "to": 1500000,
                  "amount": 0
                },
                {
                  "from": 1500000,
                  "to": 2000000,
                  "amount": 15000
                },
                {
                  "from": 2000000,
                  "to": null,
                  "amount": 20000
                }
              ]
            },
            "Gujarat": {
              "frequency": "monthly",
              "source": "Gujarat State Tax on Professions Act 1976, threshold revised w.e.f. 01-04-2022",
              "slabs": [
                {
                  "from": 0,
                  "to": 1200000,
                  "amount": 0
                },
                {
                  "from": 1200000,
                  "to": null,
                  "amount": 20000
                }
              ]
            },
            "Madhya Pradesh": {
              "frequency": "monthly",
              "source": "Madhya Pradesh Vritti Kar Adhiniyam 1995",
              "slabs": [
                {
                  "from": 0,
                  "to": 1875000,
                  "amount": 0
                },
                {
                  "from": 1875000,
                  "to": 2500000,
                  "amount": 12500
                },
                {
                  "from": 2500000,
                  "to": 3333300,
                  "amount": 16700
                },
                {
                  "from": 3333300,
                  "to": null,
                  "amount": 20800
                }
              ],
              "special_month": {
                "month": 3,
                "amount": 21200
              }
            },
            "Odisha": {
              "frequency": "monthly",
              "source": "Odisha State Tax on Professions, Trades, Callings and Employments Act 2000",
              "slabs": [
                {
                  "from": 0,
                  "to": 1330400,
                  "amount": 0
                },
                {
                  "from": 1330400,
                  "to": 2500000,
                  "amount": 12500
                },
                {
                  "from": 2500000,
                  "to": null,
                  "amount": 20000
                }
              ],
              "special_month": {
                "month": 3,
                "amount": 30000
              }
            },
            "Assam": {
              "frequency": "monthly",
              "source": "Assam Professions, Trades, Callings and Employments Taxation Act 1947",
              "slabs": [
                {
                  "from": 0,
                  "to": 1000000,
                  "amount": 0
                },
                {
                  "from": 1000000,
                  "to": 1500000,
                  "amount": 15000
                },
                {
                  "from": 1500000,
                  "to": 2500000,
                  "amount": 18000
                },
                {
                  "from": 2500000,
                  "to": null,
                  "amount": 20800
                }
              ]
            },
            "Tamil Nadu": {
              "frequency": "half_yearly",
              "source": "Tamil Nadu Town Panchayats, Municipalities and Municipal Corporations (Collection of Tax on Profession) Rules 1988 - Greater Chennai Corporation schedule",
              "slabs": [
                {
                  "from": 0,
                  "to": 2100000,
                  "amount": 0
                },
                {
                  "from": 2100000,
                  "to": 3000000,
                  "amount": 13500
                },
                {
                  "from": 3000000,
                  "to": 4500000,
                  "amount": 31500
                },
                {
                  "from": 4500000,
                  "to": 6000000,
                  "amount": 69000
                },
                {
                  "from": 6000000,
                  "to": 7500000,
                  "amount": 102500
                },
                {
                  "from": 7500000,
                  "to": null,
                  "amount": 125000
                }
              ],
              "note": "Slab income is half-yearly aggregate income, and the amount is the half-yearly levy. Local bodies outside Greater Chennai may notify their own schedule."
            },
            "Kerala": {
              "frequency": "half_yearly",
              "source": "Kerala Municipality Act 1994, section 245 and the rules thereunder",
              "slabs": [
                {
                  "from": 0,
                  "to": 1200000,
                  "amount": 0
                },
                {
                  "from": 1200000,
                  "to": 1800000,
                  "amount": 12000
                },
                {
                  "from": 1800000,
                  "to": 3000000,
                  "amount": 18000
                },
                {
                  "from": 3000000,
                  "to": 4500000,
                  "amount": 30000
                },
                {
                  "from": 4500000,
                  "to": 6000000,
                  "amount": 45000
                },
                {
                  "from": 6000000,
                  "to": 7500000,
                  "amount": 60000
                },
                {
                  "from": 7500000,
                  "to": 10000000,
                  "amount": 75000
                },
                {
                  "from": 10000000,
                  "to": 12500000,
                  "amount": 100000
                },
                {
                  "from": 12500000,
                  "to": null,
                  "amount": 125000
                }
              ],
              "note": "Slab income is half-yearly aggregate income, and the amount is the half-yearly levy."
            },
            "Bihar": {
              "frequency": "annual",
              "source": "Bihar Tax on Professions, Trades, Callings and Employments Act 2011",
              "slabs": [
                {
                  "from": 0,
                  "to": 30000000,
                  "amount": 0
                },
                {
                  "from": 30000000,
                  "to": 50000000,
                  "amount": 100000
                },
                {
                  "from": 50000000,
                  "to": 100000000,
                  "amount": 200000
                },
                {
                  "from": 100000000,
                  "to": null,
                  "amount": 250000
                }
              ],
              "note": "Slab income is annual income, and the amount is the annual levy."
            },
            "Jharkhand": {
              "frequency": "annual",
              "source": "Jharkhand Tax on Professions, Trades, Callings and Employments Act 2011",
              "slabs": [
                {
                  "from": 0,
                  "to": 30000000,
                  "amount": 0
                },
                {
                  "from": 30000000,
                  "to": 50000000,
                  "amount": 120000
                },
                {
                  "from": 50000000,
                  "to": 800000000,
                  "amount": 180000
                },
                {
                  "from": 800000000,
                  "to": 1000000000,
                  "amount": 240000
                },
                {
                  "from": 1000000000,
                  "to": null,
                  "amount": 250000
                }
              ],
              "note": "Slab income is annual income, and the amount is the annual levy."
            },
            "Punjab": {
              "frequency": "monthly",
              "source": "Punjab State Development Tax Act 2018 - payable by persons liable to income tax",
              "slabs": [
                {
                  "from": 0,
                  "to": 0,
                  "amount": 0
                },
                {
                  "from": 0,
                  "to": null,
                  "amount": 20000
                }
              ],
              "note": "A flat ₹200 per month, but only for employees whose income is liable to income tax. Applicability is not a salary slab, so callers must pass the liability flag."
            },
            "Meghalaya": {
              "frequency": "monthly",
              "source": "Meghalaya Professions, Trades, Callings and Employments Taxation Act 1947",
              "slabs": [
                {
                  "from": 0,
                  "to": 416600,
                  "amount": 0
                },
                {
                  "from": 416600,
                  "to": 625000,
                  "amount": 16500
                },
                {
                  "from": 625000,
                  "to": 833300,
                  "amount": 25000
                },
                {
                  "from": 833300,
                  "to": 1250000,
                  "amount": 41500
                },
                {
                  "from": 1250000,
                  "to": 1666600,
                  "amount": 58500
                },
                {
                  "from": 1666600,
                  "to": 2083300,
                  "amount": 80000
                },
                {
                  "from": 2083300,
                  "to": 2500000,
                  "amount": 96500
                },
                {
                  "from": 2500000,
                  "to": 4166600,
                  "amount": 104000
                },
                {
                  "from": 4166600,
                  "to": null,
                  "amount": 125000
                }
              ]
            },
            "Sikkim": {
              "frequency": "monthly",
              "source": "Sikkim Tax on Professions, Trades, Callings and Employments Act 2006",
              "slabs": [
                {
                  "from": 0,
                  "to": 2000000,
                  "amount": 0
                },
                {
                  "from": 2000000,
                  "to": 3000000,
                  "amount": 12500
                },
                {
                  "from": 3000000,
                  "to": 4000000,
                  "amount": 15000
                },
                {
                  "from": 4000000,
                  "to": null,
                  "amount": 20000
                }
              ]
            },
            "Tripura": {
              "frequency": "monthly",
              "source": "Tripura Professions, Trades, Callings and Employments Taxation Act 1997",
              "slabs": [
                {
                  "from": 0,
                  "to": 750000,
                  "amount": 0
                },
                {
                  "from": 750000,
                  "to": 1250000,
                  "amount": 15000
                },
                {
                  "from": 1250000,
                  "to": 2000000,
                  "amount": 20000
                },
                {
                  "from": 2000000,
                  "to": null,
                  "amount": 20800
                }
              ]
            },
            "Puducherry": {
              "frequency": "half_yearly",
              "source": "Puducherry Village and Commune Panchayats Act 1973 and Municipalities Act 1973",
              "slabs": [
                {
                  "from": 0,
                  "to": 9999900,
                  "amount": 0
                },
                {
                  "from": 9999900,
                  "to": 20000000,
                  "amount": 25000
                },
                {
                  "from": 20000000,
                  "to": 30000000,
                  "amount": 50000
                },
                {
                  "from": 30000000,
                  "to": 40000000,
                  "amount": 75000
                },
                {
                  "from": 40000000,
                  "to": 50000000,
                  "amount": 100000
                },
                {
                  "from": 50000000,
                  "to": null,
                  "amount": 125000
                }
              ],
              "note": "Slab income is half-yearly aggregate income."
            }
          },
          "states_without_professional_tax": [
            "Delhi",
            "Haryana",
            "Uttar Pradesh",
            "Uttarakhand",
            "Rajasthan",
            "Himachal Pradesh",
            "Jammu and Kashmir",
            "Ladakh",
            "Goa",
            "Chandigarh",
            "Arunachal Pradesh",
            "Andaman and Nicobar Islands",
            "Lakshadweep",
            "Dadra and Nagar Haveli and Daman and Diu"
          ]
        }
      }
    ],
    "_units": "Monetary values are in paise. ₹200 is 20000; ₹25,000 is 2500000."
  }
};

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
