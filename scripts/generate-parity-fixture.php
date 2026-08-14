<?php

declare(strict_types=1);

/*
 * Writes test/fixtures/parity.json by running the PHP engine.
 *
 * This is the file that makes "the two libraries agree" a testable claim rather
 * than an aspiration. Every case here is run through crmleaf/payroll-core, and
 * its complete toArray() output plus the explanation and citations are recorded.
 * The Vitest suite then feeds the *same* inputs to the TypeScript calculators and
 * asserts the results are identical, key for key and paisa for paisa.
 *
 * Regenerate after any change to either engine:
 *
 *     docker run --rm -v "$PWD:/app" -w /app payroll-php:8.3 \
 *       php packages/payroll-js/scripts/generate-parity-fixture.php
 *
 * A drift in the fixture is the point, not a nuisance: it means one side moved
 * and the other has not.
 */

$root = \dirname(__DIR__, 3);

spl_autoload_register(static function (string $class) use ($root): void {
    $prefix = 'Crmleaf\\Payroll\\';

    if (!str_starts_with($class, $prefix)) {
        return;
    }

    $file = $root.'/packages/payroll-core/src/'.str_replace('\\', '/', substr($class, \strlen($prefix))).'.php';

    if (is_file($file)) {
        require $file;
    }
});

use Crmleaf\Payroll\Calculators\BonusCalculator;
use Crmleaf\Payroll\Calculators\ComplianceCalendar;
use Crmleaf\Payroll\Calculators\CtcCalculator;
use Crmleaf\Payroll\Calculators\EpfoPenaltyCalculator;
use Crmleaf\Payroll\Calculators\EsiCalculator;
use Crmleaf\Payroll\Calculators\FnfCalculator;
use Crmleaf\Payroll\Calculators\GratuityCalculator;
use Crmleaf\Payroll\Calculators\IncomeTaxCalculator;
use Crmleaf\Payroll\Calculators\LeaveEncashmentCalculator;
use Crmleaf\Payroll\Calculators\PfCalculator;
use Crmleaf\Payroll\Calculators\RoiCalculator;
use Crmleaf\Payroll\Calculators\SavingsCalculator;
use Crmleaf\Payroll\Calculators\TdsCalculator;
use Crmleaf\Payroll\Contracts\CalculationResult;
use Crmleaf\Payroll\Money;

/** @var array<int, array{id: string, tool: string, input: array<string, mixed>}> $cases */
$cases = [
    // ---- EPF: the ₹1,250 EPS cap asymmetry, in every direction ----------------
    ['id' => 'pf-at-the-ceiling', 'tool' => 'pf', 'input' => [
        'basicSalary' => 15000, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'pf-above-ceiling-restricted', 'tool' => 'pf', 'input' => [
        'basicSalary' => 30000, 'employerRestrictsToCeiling' => true, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'pf-above-ceiling-unrestricted', 'tool' => 'pf', 'input' => [
        'basicSalary' => 30000, 'employerRestrictsToCeiling' => false, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'pf-not-an-eps-member', 'tool' => 'pf', 'input' => [
        'basicSalary' => 25000, 'epsEligible' => false, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'pf-eps-ceases-at-58', 'tool' => 'pf', 'input' => [
        'basicSalary' => 20000, 'age' => 58, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'pf-admin-charges-included', 'tool' => 'pf', 'input' => [
        'basicSalary' => 15000, 'includeAdminCharges' => true, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'pf-reduced-rate', 'tool' => 'pf', 'input' => [
        'basicSalary' => 15000, 'reducedRate' => true, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'pf-historic-6500-ceiling', 'tool' => 'pf', 'input' => [
        'basicSalary' => 30000, 'asOf' => '2013-06-01',
    ]],

    // ---- ESI: per-share round-up and the contribution-period rule -------------
    // Income tax. The most branch-heavy calculator here and, until now, the one
    // with no cross-language pinning at all. Every case carries an explicit
    // asOf so the fixture stays reproducible as later years are added.
    ['id' => 'tax-new-regime-below-rebate', 'tool' => 'incomeTax', 'input' => [
        'grossSalary' => 1200000, 'regime' => 'new', 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tax-new-regime-marginal-relief-band', 'tool' => 'incomeTax', 'input' => [
        'grossSalary' => 1285000, 'regime' => 'new', 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tax-new-regime-above-the-band', 'tool' => 'incomeTax', 'input' => [
        'grossSalary' => 2500000, 'regime' => 'new', 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tax-new-regime-surcharge', 'tool' => 'incomeTax', 'input' => [
        'grossSalary' => 15000000, 'regime' => 'new', 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tax-old-regime-with-deductions', 'tool' => 'incomeTax', 'input' => [
        'grossSalary' => 1500000, 'regime' => 'old', 'asOf' => '2025-06-01',
        'deductions' => ['80c' => 150000, '80d' => 25000],
    ]],
    ['id' => 'tax-old-regime-senior', 'tool' => 'incomeTax', 'input' => [
        'grossSalary' => 900000, 'regime' => 'old', 'age' => 62, 'asOf' => '2025-06-01',
    ]],
    // The carry-forward disclosure, pinned across both languages. A date in a
    // later financial year than the newest table resolves to that table and
    // must say so, in the same words, in PHP and in TypeScript.
    ['id' => 'tax-carried-forward-year-is-disclosed', 'tool' => 'incomeTax', 'input' => [
        'grossSalary' => 1200000, 'regime' => 'new', 'asOf' => '2027-06-15',
    ]],

    ['id' => 'esi-typical-wage', 'tool' => 'esi', 'input' => ['grossWages' => 18000, 'asOf' => '2025-06-01']],
    ['id' => 'esi-odd-wage-rounds-each-share-up', 'tool' => 'esi', 'input' => [
        'grossWages' => 17777, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'esi-exactly-at-the-limit', 'tool' => 'esi', 'input' => ['grossWages' => 21000, 'asOf' => '2025-06-01']],
    ['id' => 'esi-one-rupee-over', 'tool' => 'esi', 'input' => ['grossWages' => 21001, 'asOf' => '2025-06-01']],
    ['id' => 'esi-continuation-rule', 'tool' => 'esi', 'input' => [
        'grossWages' => 26000, 'continuingFromPriorPeriod' => true, 'asOf' => '2025-11-15',
    ]],
    ['id' => 'esi-disabled-higher-limit', 'tool' => 'esi', 'input' => [
        'grossWages' => 24000, 'disabled' => true, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'esi-daily-wage-exemption', 'tool' => 'esi', 'input' => [
        'grossWages' => 5000, 'averageDailyWage' => 170, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'esi-historic-rates', 'tool' => 'esi', 'input' => ['grossWages' => 18000, 'asOf' => '2018-06-01']],

    // ---- Gratuity: six-month rounding and the qualifying period ---------------
    ['id' => 'gratuity-eight-years', 'tool' => 'gratuity', 'input' => [
        'lastDrawnSalary' => 45000, 'yearsOfService' => 8, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'gratuity-seven-six-does-not-round', 'tool' => 'gratuity', 'input' => [
        'lastDrawnSalary' => 45000, 'yearsOfService' => 7, 'monthsOfService' => 6, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'gratuity-seven-seven-rounds-up', 'tool' => 'gratuity', 'input' => [
        'lastDrawnSalary' => 45000, 'yearsOfService' => 7, 'monthsOfService' => 7, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'gratuity-four-years-not-eligible', 'tool' => 'gratuity', 'input' => [
        'lastDrawnSalary' => 45000, 'yearsOfService' => 4, 'monthsOfService' => 11, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'gratuity-death-waives-the-minimum', 'tool' => 'gratuity', 'input' => [
        'lastDrawnSalary' => 45000, 'yearsOfService' => 3, 'monthsOfService' => 2,
        'separationReason' => 'death', 'asOf' => '2025-06-01',
    ]],
    ['id' => 'gratuity-not-covered-divides-by-30', 'tool' => 'gratuity', 'input' => [
        'lastDrawnSalary' => 45000, 'yearsOfService' => 7, 'monthsOfService' => 8,
        'covered' => false, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'gratuity-above-the-exemption-cap', 'tool' => 'gratuity', 'input' => [
        'lastDrawnSalary' => 300000, 'yearsOfService' => 25, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'gratuity-historic-ten-lakh-cap', 'tool' => 'gratuity', 'input' => [
        'lastDrawnSalary' => 300000, 'yearsOfService' => 25, 'asOf' => '2015-06-01',
    ]],

    // ---- Bonus ---------------------------------------------------------------
    ['id' => 'bonus-below-the-ceiling', 'tool' => 'bonus', 'input' => [
        'monthlyWages' => 6000, 'daysWorked' => 240, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'bonus-ceiling-applies', 'tool' => 'bonus', 'input' => [
        'monthlyWages' => 18000, 'daysWorked' => 240, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'bonus-above-eligibility-limit', 'tool' => 'bonus', 'input' => [
        'monthlyWages' => 21001, 'daysWorked' => 240, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'bonus-under-thirty-days', 'tool' => 'bonus', 'input' => [
        'monthlyWages' => 12000, 'daysWorked' => 20, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'bonus-minimum-wage-raises-the-ceiling', 'tool' => 'bonus', 'input' => [
        'monthlyWages' => 18000, 'daysWorked' => 240, 'minimumWage' => 9500, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'bonus-at-twenty-percent', 'tool' => 'bonus', 'input' => [
        'monthlyWages' => 18000, 'bonusRate' => 20, 'daysWorked' => 240, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'bonus-historic-limits', 'tool' => 'bonus', 'input' => [
        'monthlyWages' => 9000, 'daysWorked' => 240, 'asOf' => '2010-06-01',
    ]],

    // ---- Leave encashment: least of four limbs -------------------------------
    ['id' => 'leave-standard', 'tool' => 'leaveEncashment', 'input' => [
        'averageMonthlySalary' => 60000, 'leaveDaysEncashed' => 90, 'yearsOfService' => 10,
        'asOf' => '2025-06-01',
    ]],
    ['id' => 'leave-credit-limb-binds', 'tool' => 'leaveEncashment', 'input' => [
        'averageMonthlySalary' => 60000, 'leaveDaysEncashed' => 200, 'yearsOfService' => 5,
        'asOf' => '2025-06-01',
    ]],
    ['id' => 'leave-statutory-ceiling-binds', 'tool' => 'leaveEncashment', 'input' => [
        'averageMonthlySalary' => 900000, 'leaveDaysEncashed' => 300, 'yearsOfService' => 30,
        'asOf' => '2025-06-01',
    ]],
    ['id' => 'leave-government-employee', 'tool' => 'leaveEncashment', 'input' => [
        'averageMonthlySalary' => 90000, 'leaveDaysEncashed' => 300, 'yearsOfService' => 30,
        'governmentEmployee' => true, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'leave-during-service', 'tool' => 'leaveEncashment', 'input' => [
        'averageMonthlySalary' => 60000, 'leaveDaysEncashed' => 15, 'yearsOfService' => 6,
        'duringService' => true, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'leave-historic-three-lakh-ceiling', 'tool' => 'leaveEncashment', 'input' => [
        'averageMonthlySalary' => 90000, 'leaveDaysEncashed' => 300, 'yearsOfService' => 30,
        'asOf' => '2020-06-01',
    ]],

    // ---- TDS and the 87A marginal relief band --------------------------------
    ['id' => 'tds-inside-the-rebate', 'tool' => 'tds', 'input' => [
        'monthlyGross' => 100000, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tds-just-over-the-rebate-threshold', 'tool' => 'tds', 'input' => [
        'monthlyGross' => 106250, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tds-well-past-marginal-relief', 'tool' => 'tds', 'input' => [
        'monthlyGross' => 200000, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tds-old-regime-with-80c', 'tool' => 'tds', 'input' => [
        'monthlyGross' => 100000, 'regime' => 'old', 'deductions' => ['80c' => 150000], 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tds-senior-citizen-old-regime', 'tool' => 'tds', 'input' => [
        'monthlyGross' => 60000, 'regime' => 'old', 'age' => 65, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tds-surcharge-band', 'tool' => 'tds', 'input' => [
        'monthlyGross' => 500000, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tds-mid-year-joiner', 'tool' => 'tds', 'input' => [
        'monthlyGross' => 150000, 'monthsRemaining' => 5, 'taxAlreadyDeducted' => 40000, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'tds-historic-year', 'tool' => 'tds', 'input' => [
        'monthlyGross' => 100000, 'asOf' => '2024-06-01',
    ]],

    // ---- CTC -----------------------------------------------------------------
    ['id' => 'ctc-twelve-lakh-karnataka', 'tool' => 'ctc', 'input' => [
        'annualCtc' => 1200000, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'ctc-esi-applicable', 'tool' => 'ctc', 'input' => [
        'annualCtc' => 240000, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'ctc-maharashtra-old-regime', 'tool' => 'ctc', 'input' => [
        'annualCtc' => 1800000, 'state' => 'Maharashtra', 'regime' => 'old', 'asOf' => '2025-06-01',
    ]],
    ['id' => 'ctc-with-bonus-and-leave', 'tool' => 'ctc', 'input' => [
        'annualCtc' => 600000, 'includeBonus' => true, 'includeLeaveEncashment' => true, 'asOf' => '2025-06-01',
    ]],
    ['id' => 'ctc-uncapped-employer-pf', 'tool' => 'ctc', 'input' => [
        'annualCtc' => 2400000, 'employerPfRestrictedToCeiling' => false, 'asOf' => '2025-06-01',
    ]],

    // ---- F&F -----------------------------------------------------------------
    ['id' => 'fnf-seven-year-resignation', 'tool' => 'fnf', 'input' => [
        'monthlyGross' => 80000, 'monthlyBasic' => 40000,
        'joiningDate' => '2018-06-01', 'lastWorkingDate' => '2025-08-20',
        'leaveDaysBalance' => 24, 'noticePeriodDays' => 60, 'noticeDaysServed' => 60,
    ]],
    ['id' => 'fnf-notice-shortfall', 'tool' => 'fnf', 'input' => [
        'monthlyGross' => 80000, 'monthlyBasic' => 40000,
        'joiningDate' => '2022-01-10', 'lastWorkingDate' => '2025-02-28',
        'leaveDaysBalance' => 8, 'noticePeriodDays' => 90, 'noticeDaysServed' => 15,
    ]],
    ['id' => 'fnf-exactly-five-years', 'tool' => 'fnf', 'input' => [
        'monthlyGross' => 60000, 'monthlyBasic' => 30000,
        'joiningDate' => '2020-01-01', 'lastWorkingDate' => '2024-12-31',
        'leaveDaysBalance' => 30,
    ]],
    ['id' => 'fnf-death-in-service', 'tool' => 'fnf', 'input' => [
        'monthlyGross' => 70000, 'monthlyBasic' => 35000,
        'joiningDate' => '2023-04-01', 'lastWorkingDate' => '2025-07-15',
        'leaveDaysBalance' => 12, 'noticePeriodDays' => 60, 'noticeDaysServed' => 0,
        'separationReason' => 'death',
    ]],
    ['id' => 'fnf-esi-covered-with-lop', 'tool' => 'fnf', 'input' => [
        'monthlyGross' => 20000, 'monthlyBasic' => 10000,
        'joiningDate' => '2019-05-06', 'lastWorkingDate' => '2025-06-18',
        'leaveDaysBalance' => 10, 'unpaidDays' => 3, 'state' => 'Tamil Nadu',
    ]],

    // ---- EPFO penalties: both damages regimes --------------------------------
    ['id' => 'epfo-paid-on-time', 'tool' => 'epfoPenalty', 'input' => [
        'contributionAmount' => 250000, 'wageMonth' => '2025-04-01', 'actualPaymentDate' => '2025-05-15',
    ]],
    ['id' => 'epfo-flat-one-percent', 'tool' => 'epfoPenalty', 'input' => [
        'contributionAmount' => 250000, 'wageMonth' => '2025-04-01', 'actualPaymentDate' => '2025-09-30',
    ]],
    ['id' => 'epfo-one-day-late', 'tool' => 'epfoPenalty', 'input' => [
        'contributionAmount' => 250000, 'wageMonth' => '2025-04-01', 'actualPaymentDate' => '2025-05-16',
    ]],
    ['id' => 'epfo-old-slab-scale', 'tool' => 'epfoPenalty', 'input' => [
        'contributionAmount' => 250000, 'wageMonth' => '2023-05-01', 'actualPaymentDate' => '2023-09-20',
    ]],
    ['id' => 'epfo-damages-capped-at-arrears', 'tool' => 'epfoPenalty', 'input' => [
        'contributionAmount' => 100000, 'wageMonth' => '2024-07-01', 'actualPaymentDate' => '2035-01-05',
    ]],

    // ---- Compliance calendar -------------------------------------------------
    ['id' => 'calendar-fy-2025-26', 'tool' => 'complianceCalendar', 'input' => [
        'financialYear' => '2025-26', 'asOf' => '2025-04-01',
    ]],
    ['id' => 'calendar-qrmp', 'tool' => 'complianceCalendar', 'input' => [
        'financialYear' => '2025-26', 'qrmp' => true, 'asOf' => '2025-04-01',
    ]],
    ['id' => 'calendar-pf-only', 'tool' => 'complianceCalendar', 'input' => [
        'financialYear' => '2026-27', 'only' => ['PF_ECR', 'TDS_PAY'], 'asOf' => '2025-04-01',
    ]],

    // ---- Business arithmetic -------------------------------------------------
    ['id' => 'roi-typical', 'tool' => 'roi', 'input' => [
        'employeeCount' => 120, 'hourlyRate' => 800, 'hoursPerCycleManual' => 24,
        'softwareAnnualCost' => 180000, 'penaltyCostPerYear' => 25000, 'errorCostPerYear' => 40000,
    ]],
    ['id' => 'roi-no-software-cost', 'tool' => 'roi', 'input' => [
        'employeeCount' => 40, 'hourlyRate' => 650, 'hoursPerCycleManual' => 10,
    ]],
    ['id' => 'roi-never-pays-back', 'tool' => 'roi', 'input' => [
        'employeeCount' => 10, 'hourlyRate' => 500, 'hoursPerCycleManual' => 0,
        'automationEfficiency' => 0.0, 'softwareAnnualCost' => 100000,
    ]],
    ['id' => 'savings-typical', 'tool' => 'savings', 'input' => [
        'employeeCount' => 120, 'currentPerEmployeePerMonth' => 120, 'proposedPerEmployeePerMonth' => 70,
        'currentAnnualPlatformFee' => 60000, 'migrationCost' => 25000,
    ]],
    ['id' => 'savings-proposal-costs-more', 'tool' => 'savings', 'input' => [
        'employeeCount' => 15, 'currentPerEmployeePerMonth' => 50, 'proposedPerEmployeePerMonth' => 90,
        'proposedAnnualPlatformFee' => 12000, 'contractMonths' => 36,
    ]],
];

$out = ['cases' => []];

foreach ($cases as $case) {
    $result = run($case['tool'], $case['input']);

    $out['cases'][] = [
        'id' => $case['id'],
        'tool' => $case['tool'],
        'input' => $case['input'],
        'expected' => $result->toArray(),
        'explanation' => $result->explain(),
        'citations' => $result->citations(),
    ];
}

$file = \dirname(__DIR__).'/test/fixtures/parity.json';

if (!is_dir(\dirname($file))) {
    mkdir(\dirname($file), 0o755, true);
}

file_put_contents(
    $file,
    json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES).PHP_EOL,
);

printf('Wrote %d parity cases to %s%s', \count($out['cases']), $file, PHP_EOL);

/**
 * @param array<string, mixed> $input
 */
function run(string $tool, array $input): CalculationResult
{
    return match ($tool) {
        'pf' => (new PfCalculator())->calculate(
            basicSalary: rupees($input['basicSalary']),
            employerRestrictsToCeiling: $input['employerRestrictsToCeiling'] ?? true,
            epsEligible: $input['epsEligible'] ?? true,
            age: $input['age'] ?? null,
            reducedRate: $input['reducedRate'] ?? false,
            includeAdminCharges: $input['includeAdminCharges'] ?? true,
            asOf: $input['asOf'] ?? null,
        ),
        'esi' => (new EsiCalculator())->calculate(
            grossWages: rupees($input['grossWages']),
            disabled: $input['disabled'] ?? false,
            averageDailyWage: isset($input['averageDailyWage']) ? rupees($input['averageDailyWage']) : null,
            continuingFromPriorPeriod: $input['continuingFromPriorPeriod'] ?? false,
            asOf: $input['asOf'] ?? null,
        ),
        'gratuity' => (new GratuityCalculator())->calculate(
            lastDrawnSalary: rupees($input['lastDrawnSalary']),
            yearsOfService: $input['yearsOfService'],
            monthsOfService: $input['monthsOfService'] ?? 0,
            covered: $input['covered'] ?? true,
            separationReason: $input['separationReason'] ?? 'resignation',
            asOf: $input['asOf'] ?? null,
        ),
        'bonus' => (new BonusCalculator())->calculate(
            monthlyWages: rupees($input['monthlyWages']),
            bonusRate: $input['bonusRate'] ?? 8.33,
            monthsWorked: $input['monthsWorked'] ?? 12,
            daysWorked: $input['daysWorked'] ?? 30,
            minimumWage: isset($input['minimumWage']) ? rupees($input['minimumWage']) : null,
            asOf: $input['asOf'] ?? null,
        ),
        'leaveEncashment' => (new LeaveEncashmentCalculator())->calculate(
            averageMonthlySalary: rupees($input['averageMonthlySalary']),
            leaveDaysEncashed: $input['leaveDaysEncashed'],
            yearsOfService: $input['yearsOfService'],
            governmentEmployee: $input['governmentEmployee'] ?? false,
            duringService: $input['duringService'] ?? false,
            exemptionAlreadyClaimed: isset($input['exemptionAlreadyClaimed'])
                ? rupees($input['exemptionAlreadyClaimed'])
                : null,
            asOf: $input['asOf'] ?? null,
        ),
        'incomeTax' => (new IncomeTaxCalculator())->calculate(
            grossSalary: rupees($input['grossSalary']),
            regime: $input['regime'] ?? 'new',
            age: $input['age'] ?? 30,
            deductions: $input['deductions'] ?? [],
            otherIncome: isset($input['otherIncome']) ? rupees($input['otherIncome']) : null,
            asOf: $input['asOf'] ?? null,
        ),
        'tds' => (new TdsCalculator())->calculate(
            monthlyGross: rupees($input['monthlyGross']),
            regime: $input['regime'] ?? 'new',
            age: $input['age'] ?? 30,
            deductions: $input['deductions'] ?? [],
            monthsRemaining: $input['monthsRemaining'] ?? 12,
            taxAlreadyDeducted: isset($input['taxAlreadyDeducted']) ? rupees($input['taxAlreadyDeducted']) : null,
            asOf: $input['asOf'] ?? null,
        ),
        'ctc' => (new CtcCalculator())->calculate(
            annualCtc: rupees($input['annualCtc']),
            state: $input['state'] ?? 'Karnataka',
            basicPercent: $input['basicPercent'] ?? 40,
            hraPercent: $input['hraPercent'] ?? 50,
            includeBonus: $input['includeBonus'] ?? false,
            includeLeaveEncashment: $input['includeLeaveEncashment'] ?? false,
            employerPfRestrictedToCeiling: $input['employerPfRestrictedToCeiling'] ?? true,
            regime: $input['regime'] ?? 'new',
            asOf: $input['asOf'] ?? null,
        ),
        'fnf' => (new FnfCalculator())->calculate(
            monthlyGross: rupees($input['monthlyGross']),
            monthlyBasic: rupees($input['monthlyBasic']),
            joiningDate: new DateTimeImmutable($input['joiningDate']),
            lastWorkingDate: new DateTimeImmutable($input['lastWorkingDate']),
            unpaidDays: $input['unpaidDays'] ?? 0,
            leaveDaysBalance: $input['leaveDaysBalance'] ?? 0,
            noticePeriodDays: $input['noticePeriodDays'] ?? 0,
            noticeDaysServed: $input['noticeDaysServed'] ?? 0,
            otherEarnings: isset($input['otherEarnings']) ? rupees($input['otherEarnings']) : null,
            recoveries: isset($input['recoveries']) ? rupees($input['recoveries']) : null,
            separationReason: $input['separationReason'] ?? 'resignation',
            covered: $input['covered'] ?? true,
            state: $input['state'] ?? 'Karnataka',
            asOf: $input['asOf'] ?? null,
        ),
        'epfoPenalty' => (new EpfoPenaltyCalculator())->calculate(
            contributionAmount: rupees($input['contributionAmount']),
            wageMonth: new DateTimeImmutable($input['wageMonth']),
            actualPaymentDate: new DateTimeImmutable($input['actualPaymentDate']),
            asOf: $input['asOf'] ?? null,
        ),
        'complianceCalendar' => (new ComplianceCalendar())->forFinancialYear(
            financialYear: $input['financialYear'] ?? '2025-26',
            only: $input['only'] ?? [],
            qrmp: $input['qrmp'] ?? false,
            asOf: $input['asOf'] ?? null,
        ),
        'roi' => (new RoiCalculator())->calculate(
            employeeCount: $input['employeeCount'],
            hourlyRate: rupees($input['hourlyRate']),
            hoursPerCycleManual: $input['hoursPerCycleManual'],
            cyclesPerYear: $input['cyclesPerYear'] ?? 12,
            softwareAnnualCost: isset($input['softwareAnnualCost']) ? rupees($input['softwareAnnualCost']) : null,
            automationEfficiency: $input['automationEfficiency'] ?? 0.8,
            penaltyCostPerYear: isset($input['penaltyCostPerYear']) ? rupees($input['penaltyCostPerYear']) : null,
            errorCostPerYear: isset($input['errorCostPerYear']) ? rupees($input['errorCostPerYear']) : null,
        ),
        'savings' => (new SavingsCalculator())->calculate(
            employeeCount: $input['employeeCount'],
            currentPerEmployeePerMonth: rupees($input['currentPerEmployeePerMonth']),
            proposedPerEmployeePerMonth: rupees($input['proposedPerEmployeePerMonth']),
            currentAnnualPlatformFee: isset($input['currentAnnualPlatformFee'])
                ? rupees($input['currentAnnualPlatformFee'])
                : null,
            proposedAnnualPlatformFee: isset($input['proposedAnnualPlatformFee'])
                ? rupees($input['proposedAnnualPlatformFee'])
                : null,
            migrationCost: isset($input['migrationCost']) ? rupees($input['migrationCost']) : null,
            contractMonths: $input['contractMonths'] ?? 12,
        ),
        default => throw new InvalidArgumentException(sprintf('Unknown tool "%s".', $tool)),
    };
}

function rupees(int|float|string $value): Money
{
    return Money::fromRupees($value);
}
