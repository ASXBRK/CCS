/**
 * Golden-case regression against StartingBlocks.gov.au.
 *
 * Each case in tests/golden-cases.json is a set of inputs entered into the
 * live calculator plus the numbers it displayed. Any difference of more than
 * `tolerance` dollars fails. Fill this file by hand (a few dozen cases) or
 * with scripts/generate-cases.mjs + a Playwright run (thousands).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { calculateCcs, FamilyInput, Totals } from '../src/ccsEngine';

interface GoldenCase {
  name: string;
  input: FamilyInput;
  expected: {
    perWeek?: Partial<Totals>;
    perFortnight?: Partial<Totals>;
    perYear?: Partial<Totals>;
    children?: Array<{ id: string; ccsPercent?: number; hourlySubsidy?: number; subsidisedHoursPerFortnight?: number }>;
  };
  tolerance?: number;
  skip?: boolean;
  /** Why a case is skipped — e.g. the site declined to model one of its children. */
  skipReason?: string;
}

const TOTAL_KEYS = ['fees', 'subsidy', 'paidSubsidy', 'withheld', 'outOfPocket'] as const;

const cases: GoldenCase[] = JSON.parse(readFileSync(new URL('./golden-cases.json', import.meta.url), 'utf8'));

// Compare in whole cents. Math.abs(65.26 - 65.25) is 0.010000000000005, so a
// genuine one-cent difference would fail a 0.01 tolerance on roughly a fifth of
// the figures purely on float representation.
const cents = (n: number) => Math.round(n * 100);

describe('golden cases vs StartingBlocks.gov.au', () => {
  for (const g of cases) {
    (g.skip ? it.skip : it)(g.name, () => {
      const res = calculateCcs(g.input);
      // Kept strict. A dollar of slack was fine while the engine multiplied an
      // unrounded hourly subsidy by the hours; now that it rounds to cents
      // first, as the site does, the figures agree exactly and a loose
      // tolerance would only hide a future regression.
      const tol = g.tolerance ?? 0.01;
      for (const period of ['perWeek', 'perFortnight', 'perYear'] as const) {
        const exp = g.expected[period];
        if (!exp) continue;
        for (const k of TOTAL_KEYS) {
          if (exp[k] != null) expect(Math.abs(cents(res.totals[period][k]) - cents(exp[k]!)), `${period}.${k}`).toBeLessThanOrEqual(cents(tol));
        }
      }
      for (const ec of g.expected.children ?? []) {
        const rc = res.children.find(c => c.id === ec.id)!;
        expect(rc, `child ${ec.id} missing`).toBeTruthy();
        if (ec.ccsPercent != null) expect(Math.abs(rc.ccsPercent - ec.ccsPercent), 'ccsPercent').toBeLessThanOrEqual(0.005);
        if (ec.hourlySubsidy != null) expect(Math.abs(cents(rc.hourlySubsidy) - cents(ec.hourlySubsidy)), 'hourlySubsidy').toBeLessThanOrEqual(cents(tol));
        if (ec.subsidisedHoursPerFortnight != null) expect(rc.subsidisedHoursPerFortnight).toBe(ec.subsidisedHoursPerFortnight);
      }
    });
  }
});
