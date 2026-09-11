/**
 * CCS calculation engine. Pure functions, no side effects, no framework.
 *
 * Mirrors the StartingBlocks.gov.au calculator logic:
 *   1. CCS % from combined family income (standard table; higher table for
 *      second and younger children aged 5 or under).
 *   2. Hourly fee = daily fee / session hours (or hourly fee if given).
 *   3. Subsidy per hour = CCS % × min(hourly fee, hourly rate cap).
 *   4. Subsidised hours per fortnight = min(hours attended, entitlement),
 *      entitlement = 100 if participation > 48 hrs/fortnight (lower of the
 *      two adults) or First Nations child or exemption, otherwise 72.
 *   5. Subsidy per fortnight = subsidy per hour × subsidised hours.
 *   6. Out of pocket = fees − subsidy (optionally after 5% withholding).
 */

import { CareType, CcsRates, getRates, standardUpperThreshold } from './ccsRates';

// ---------- Inputs ----------

export interface ChildInput {
  id: string;
  /** Age in whole years at the start of the fortnight. Higher rate applies only if ≤ 5. */
  ageYears: number;
  /** Attends school (affects hourly cap for CBDC/OSHC). Defaults to ageYears >= 6 if omitted. */
  schoolAge?: boolean;
  careType: CareType;
  /** Provide either dailyFee + hoursPerDay, or hourlyFee + hoursPerDay */
  dailyFee?: number;
  hourlyFee?: number;
  hoursPerDay: number;
  daysPerFortnight: number; // e.g. 3 days/week = 6
  /** First Nations child → 100 hrs entitlement regardless of participation */
  firstNations?: boolean;
}

export interface FamilyInput {
  ccsYear?: string;
  partnered: boolean;
  /** Combined adjusted taxable income for the financial year */
  familyIncome: number;
  /**
   * Recognised participation hours per fortnight for each adult.
   * Entitlement uses the LOWER of the two when partnered.
   * Omit / null for "not applicable" (e.g. single parent has only one entry).
   */
  participationHours: { adult1: number; adult2?: number | null };
  /** Exemption from participation requirements (e.g. ACCS, Minister's Rules) → 100 hrs */
  participationExempt?: boolean;
  /** Show results net of the 5% withholding Services Australia applies during the year */
  applyWithholding?: boolean;
  children: ChildInput[];
}

// ---------- Outputs ----------

export interface ChildResult {
  id: string;
  rateType: 'standard' | 'higher';
  ccsPercent: number;          // e.g. 71.62
  hourlyFee: number;
  hourlyCap: number;
  cappedHourlyFee: number;     // min(hourlyFee, hourlyCap)
  hourlySubsidy: number;       // ccsPercent/100 × cappedHourlyFee
  hoursPerFortnight: number;
  entitledHoursPerFortnight: number;
  subsidisedHoursPerFortnight: number;
  unsubsidisedHoursPerFortnight: number;
  feePerFortnight: number;
  subsidyPerFortnight: number; // before withholding
  withheldPerFortnight: number;
  paidSubsidyPerFortnight: number; // after withholding if applied, else = subsidyPerFortnight
  outOfPocketPerFortnight: number;
}

export interface FamilyResult {
  ccsYear: string;
  familyIncome: number;
  standardPercent: number;
  higherPercent: number | null;  // null when higher rate does not apply to this family
  entitledHoursPerFortnight: number;
  children: ChildResult[];
  totals: {
    perFortnight: Totals;
    perWeek: Totals;
    perYear: Totals; // × 26 fortnights
  };
  warnings: string[];
}

export interface Totals {
  fees: number;
  subsidy: number;      // gross CCS
  withheld: number;
  paidSubsidy: number;  // what actually reduces the fee
  outOfPocket: number;
}

// ---------- Percent tables ----------

function roundPercent(p: number, r: CcsRates): number {
  const { decimals, mode } = r.percentRounding;
  if (mode === 'none') return p;
  const f = 10 ** decimals;
  return mode === 'down' ? Math.floor(p * f) / f : Math.round(p * f) / f;
}

/** Standard CCS percentage for the family income. */
export function standardPercent(income: number, r: CcsRates = getRates()): number {
  const { maxPercent, lowerThreshold, taperPerDollars } = r.standard;
  if (income <= lowerThreshold) return maxPercent;
  if (income >= standardUpperThreshold(r)) return 0;
  return roundPercent(maxPercent - (income - lowerThreshold) / taperPerDollars, r);
}

/**
 * Higher CCS percentage (second and younger children aged 5 or under).
 * Returns null when the family income is at/above the revert threshold,
 * meaning ALL children use the standard rate.
 */
export function higherPercent(income: number, r: CcsRates = getRates()): number | null {
  const h = r.higher;
  // $370,726 itself still gets the higher rate; it ends at $370,727 (Services
  // Australia: "income below $370,727"; confirmed on the live calculator).
  if (income > h.revertThreshold) return null;
  if (income <= h.t1) return h.maxPercent;
  if (income < h.t2) return roundPercent(h.maxPercent - (income - h.t1) / h.taperPerDollars, r);
  if (income <= h.t3) return h.plateau1Percent;
  if (income < h.t4) return roundPercent(h.plateau1Percent - (income - h.t3) / h.taperPerDollars, r);
  return h.plateau2Percent; // t4 ≤ income ≤ revertThreshold
}

// ---------- Hours ----------

export function entitledHours(input: FamilyInput, r: CcsRates = getRates()): number {
  if (input.participationExempt) return r.hours.full;
  const a1 = input.participationHours.adult1 ?? 0;
  const a2 = input.partnered ? (input.participationHours.adult2 ?? 0) : null;
  const lowest = a2 === null ? a1 : Math.min(a1, a2);
  return lowest > r.hours.participationHoursForFull ? r.hours.full : r.hours.baseline;
}

// ---------- Money helpers ----------

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function hourlyFeeOf(c: ChildInput): number {
  if (c.hourlyFee != null) return c.hourlyFee;
  if (c.dailyFee != null && c.hoursPerDay > 0) return c.dailyFee / c.hoursPerDay;
  return 0;
}

// ---------- Main ----------

export function calculateCcs(input: FamilyInput): FamilyResult {
  const r = getRates(input.ccsYear);
  const warnings: string[] = [];
  const income = Math.max(0, input.familyIncome || 0);

  const stdPct = standardPercent(income, r);
  const higherPct = higherPercent(income, r);
  const familyHours = entitledHours(input, r);

  // Identify the "standard rate child": the eldest child aged ≤ 5.
  // All other children aged ≤ 5 get the higher rate (if it applies).
  const underSix = input.children.filter(c => c.ageYears <= 5);
  const standardRateChildId =
    underSix.length > 0
      ? [...underSix].sort((a, b) => b.ageYears - a.ageYears)[0].id
      : null;
  const higherApplies = higherPct !== null && underSix.length >= 2;

  if (input.children.some(c => c.careType === 'IHC') && input.children.length > 1) {
    warnings.push('In Home Care cap is per family, not per child; this estimate applies it per child.');
  }

  const children: ChildResult[] = input.children.map(c => {
    // In Home Care is subsidised per family and is always paid the standard rate.
    // An IHC child still counts toward the two-children test and toward which
    // child is the eldest under six (both decided above); only its own rate is
    // forced to standard.
    const isHigher = higherApplies && c.ageYears <= 5 && c.id !== standardRateChildId
                  && c.careType !== 'IHC';
    const pct = isHigher ? (higherPct as number) : stdPct;

    const schoolAge = c.schoolAge ?? c.ageYears >= 6;
    const cap = schoolAge ? r.hourlyCaps[c.careType].schoolAge : r.hourlyCaps[c.careType].belowSchoolAge;

    const hourlyFee = hourlyFeeOf(c);
    const cappedFee = Math.min(hourlyFee, cap);
    // Services Australia works in a per-hour subsidy expressed in cents, then
    // multiplies by hours. The rate is taken as a 4-decimal fraction rather than
    // pct / 100 so that half-cent ties resolve the way theirs do: 47.70% of $15
    // is 7.15 and 51.70% of $15 is 7.76, both exact ties in decimal.
    const hourlySubsidy = round2(Number((pct / 100).toFixed(4)) * cappedFee);

    const hours = c.hoursPerDay * c.daysPerFortnight;
    const entitled = c.firstNations ? r.hours.full : familyHours;
    const subsidisedHours = Math.min(hours, entitled);

    const feeFn = hourlyFee * hours;
    const subsidyFn = hourlySubsidy * subsidisedHours;
    const withheld = input.applyWithholding ? round2(subsidyFn * r.withholdingRate) : 0;
    const paid = subsidyFn - withheld;

    return {
      id: c.id,
      rateType: isHigher ? 'higher' : 'standard',
      ccsPercent: pct,
      hourlyFee: round2(hourlyFee),
      hourlyCap: cap,
      cappedHourlyFee: round2(cappedFee),
      hourlySubsidy: round2(hourlySubsidy),
      hoursPerFortnight: hours,
      entitledHoursPerFortnight: entitled,
      subsidisedHoursPerFortnight: subsidisedHours,
      unsubsidisedHoursPerFortnight: Math.max(0, hours - subsidisedHours),
      feePerFortnight: round2(feeFn),
      subsidyPerFortnight: round2(subsidyFn),
      withheldPerFortnight: round2(withheld),
      paidSubsidyPerFortnight: round2(paid),
      outOfPocketPerFortnight: round2(feeFn - paid),
    };
  });

  const sum = (k: keyof ChildResult) => children.reduce((t, c) => t + (c[k] as number), 0);
  const fn: Totals = {
    fees: round2(sum('feePerFortnight')),
    subsidy: round2(sum('subsidyPerFortnight')),
    withheld: round2(sum('withheldPerFortnight')),
    paidSubsidy: round2(sum('paidSubsidyPerFortnight')),
    outOfPocket: round2(sum('outOfPocketPerFortnight')),
  };
  // Weekly figures are each child's fortnight halved and rounded, then summed —
  // the same as reading each child's weekly column and adding them up, which is
  // how StartingBlocks builds its family total. Halving the family fortnight
  // instead can land a cent or two away on three-child families.
  //
  // The one exception is withholding, which the site works out afresh for the
  // week as 5% of the week's gross rather than halving the fortnight's amount.
  // It is rounded without the EPSILON nudge on purpose: the site's own float
  // arithmetic sends exact half-cents down here, and this is what reproduces
  // its weekly withholding to the cent across every recorded case.
  const weekly = (k: keyof ChildResult) => round2(children.reduce((t, c) => t + round2((c[k] as number) / 2), 0));
  const weeklyWithheld = round2(children.reduce((t, c) => {
    const grossWeek = round2(c.subsidyPerFortnight / 2);
    return t + (input.applyWithholding ? Math.round(grossWeek * r.withholdingRate * 100) / 100 : 0);
  }, 0));
  const wk: Totals = {
    fees: weekly('feePerFortnight'),
    subsidy: weekly('subsidyPerFortnight'),
    withheld: weeklyWithheld,
    paidSubsidy: weekly('paidSubsidyPerFortnight'),
    outOfPocket: weekly('outOfPocketPerFortnight'),
  };
  const scale = (t: Totals, k: number): Totals => ({
    fees: round2(t.fees * k),
    subsidy: round2(t.subsidy * k),
    withheld: round2(t.withheld * k),
    paidSubsidy: round2(t.paidSubsidy * k),
    outOfPocket: round2(t.outOfPocket * k),
  });

  return {
    ccsYear: r.ccsYear,
    familyIncome: income,
    standardPercent: stdPct,
    higherPercent: higherApplies ? higherPct : null,
    entitledHoursPerFortnight: familyHours,
    children,
    totals: { perFortnight: fn, perWeek: wk, perYear: scale(fn, 26) },
    warnings,
  };
}
