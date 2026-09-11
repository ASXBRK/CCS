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
import { calculateCcs, FamilyInput } from '../src/ccsEngine';

interface GoldenCase {
  name: string;
  input: FamilyInput;
  expected: {
    perWeek?: { fees?: number; subsidy?: number; outOfPocket?: number };
    perFortnight?: { fees?: number; subsidy?: number; outOfPocket?: number };
    perYear?: { fees?: number; subsidy?: number; outOfPocket?: number };
    children?: Array<{ id: string; ccsPercent?: number; hourlySubsidy?: number; subsidisedHoursPerFortnight?: number }>;
  };
  tolerance?: number;
  skip?: boolean;
}

const cases: GoldenCase[] = JSON.parse(readFileSync(new URL('./golden-cases.json', import.meta.url), 'utf8'));

describe('golden cases vs StartingBlocks.gov.au', () => {
  for (const g of cases) {
    (g.skip ? it.skip : it)(g.name, () => {
      const res = calculateCcs(g.input);
      const tol = g.tolerance ?? 0.01;
      for (const period of ['perWeek', 'perFortnight', 'perYear'] as const) {
        const exp = g.expected[period];
        if (!exp) continue;
        for (const k of ['fees', 'subsidy', 'outOfPocket'] as const) {
          if (exp[k] != null) expect(Math.abs(res.totals[period][k] - exp[k]!), `${period}.${k}`).toBeLessThanOrEqual(tol);
        }
      }
      for (const ec of g.expected.children ?? []) {
        const rc = res.children.find(c => c.id === ec.id)!;
        expect(rc, `child ${ec.id} missing`).toBeTruthy();
        if (ec.ccsPercent != null) expect(Math.abs(rc.ccsPercent - ec.ccsPercent), 'ccsPercent').toBeLessThanOrEqual(0.005);
        if (ec.hourlySubsidy != null) expect(Math.abs(rc.hourlySubsidy - ec.hourlySubsidy), 'hourlySubsidy').toBeLessThanOrEqual(tol);
        if (ec.subsidisedHoursPerFortnight != null) expect(rc.subsidisedHoursPerFortnight).toBe(ec.subsidisedHoursPerFortnight);
      }
    });
  }
});
