/**
 * Child Care Subsidy (CCS) parameters by CCS year.
 *
 * This is the ONLY file that should change at annual indexation.
 * Source: A New Tax System (Family Assistance) Act 1999, Sch 2, as indexed
 * by the Department of Education for the CCS year starting 6 July 2026.
 * Figures cross-checked against the Department of Education indexation
 * announcement (June 2026) and the au-fy-figures skill (Macquarie BBB 2026/27).
 */

export type CareType = 'CBDC' | 'FDC' | 'OSHC' | 'IHC';

export interface CcsRates {
  ccsYear: string;
  effectiveFrom: string; // ISO date, first Monday of the CCS year
  /** Standard rate — applies to the eldest child under 6, and all school-age children */
  standard: {
    maxPercent: number;      // 90
    lowerThreshold: number;  // income at/below which maxPercent applies
    taperPerDollars: number; // 1 percentage point per this many dollars
    // upperThreshold is implied: lower + maxPercent * taperPerDollars
  };
  /** Higher rate — second and younger children aged 5 or under, while family income < revertThreshold */
  higher: {
    maxPercent: number;       // 95
    t1: number;               // ≤ t1 → 95%
    taperPerDollars: number;  // 3000
    plateau1Percent: number;  // 80
    t2: number;               // t1 + (95-80)*3000; t2..t3 → 80%
    t3: number;               // > t3 tapers again
    plateau2Percent: number;  // 50
    t4: number;               // t3 + (80-50)*3000; t4..t5 → 50%
    revertThreshold: number;  // t5: at/above → higher rate no longer applies
  };
  /** Hourly rate caps ($ per hour). IHC cap is per family, not per child. */
  hourlyCaps: Record<CareType, { belowSchoolAge: number; schoolAge: number }>;
  /** Subsidised hours per fortnight under the 3 Day Guarantee (from 5 Jan 2026) */
  hours: {
    baseline: number;                    // 72
    full: number;                        // 100
    participationHoursForFull: number;   // strictly MORE than this → full (48)
  };
  /** Services Australia withholds this share of CCS until balancing */
  withholdingRate: number; // 0.05
  /** How the CCS percentage is rounded. Tune against golden cases. */
  percentRounding: { decimals: number; mode: 'nearest' | 'down' | 'none' };
}

export const CCS_RATES: Record<string, CcsRates> = {
  '2026-27': {
    ccsYear: '2026-27',
    effectiveFrom: '2026-07-06',
    standard: {
      maxPercent: 90,
      lowerThreshold: 88_520,
      taperPerDollars: 5_000, // upper threshold = 88,520 + 450,000 = 538,520
    },
    higher: {
      maxPercent: 95,
      t1: 146_437,
      taperPerDollars: 3_000,
      plateau1Percent: 80,
      t2: 191_437,
      t3: 270_726,
      plateau2Percent: 50,
      t4: 360_726,
      revertThreshold: 370_726,
    },
    hourlyCaps: {
      CBDC: { belowSchoolAge: 15.19, schoolAge: 13.30 },
      OSHC: { belowSchoolAge: 15.19, schoolAge: 13.30 },
      FDC:  { belowSchoolAge: 14.08, schoolAge: 14.08 },
      IHC:  { belowSchoolAge: 41.31, schoolAge: 41.31 },
    },
    hours: { baseline: 72, full: 100, participationHoursForFull: 48 },
    withholdingRate: 0.05,
    // Services Australia expresses CCS % to two decimal places. If golden
    // cases show StartingBlocks rounding down (or not at all), change here.
    percentRounding: { decimals: 2, mode: 'nearest' },
  },
};

export const CURRENT_CCS_YEAR = '2026-27';

export function getRates(ccsYear: string = CURRENT_CCS_YEAR): CcsRates {
  const r = CCS_RATES[ccsYear];
  if (!r) throw new Error(`No CCS rates loaded for ${ccsYear}`);
  return r;
}

/** Derived helpers (kept here so consumers never hard-code thresholds) */
export function standardUpperThreshold(r: CcsRates): number {
  return r.standard.lowerThreshold + r.standard.maxPercent * r.standard.taperPerDollars;
}
