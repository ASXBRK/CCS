/**
 * Generates N random input cases spanning every edge of the tables so you can
 * run them through StartingBlocks.gov.au (manually or via Playwright) and
 * paste the displayed results back into tests/golden-cases.json.
 *
 *   node scripts/generate-cases.mjs 1000 > tests/golden-inputs.json
 */
import { writeFileSync } from 'node:fs';

export function generateCases(n) {
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

// Income points that matter: every threshold ±1, plus random fills.
const edges = [0, 88519, 88520, 88521, 146436, 146437, 146438, 191436, 191437, 191438,
  270725, 270726, 270727, 360725, 360726, 360727, 370725, 370726, 370727, 538519, 538520, 538521];
const careTypes = ['CBDC', 'FDC', 'OSHC', 'IHC'];

const cases = [];
for (let i = 0; i < n; i++) {
  const partnered = Math.random() < 0.7;
  const familyIncome = i < edges.length ? edges[i] : Math.round(rnd(30_000, 600_000) / 10) * 10;
  const nChildren = pick([1, 1, 1, 2, 2, 3]);
  const children = Array.from({ length: nChildren }, (_, k) => {
    const careType = pick(careTypes);
    const ageYears = careType === 'OSHC' ? pick([5, 6, 7, 9, 12]) : pick([0, 1, 2, 3, 4, 5, 6]);
    return {
      id: `child-${k + 1}`, ageYears, careType,
      dailyFee: Math.round(rnd(80, 220)),
      hoursPerDay: careType === 'OSHC' ? pick([2, 3, 4]) : pick([8, 9, 10, 11, 12]),
      daysPerFortnight: pick([2, 4, 6, 8, 10]),
    };
  });
  cases.push({
    name: `gen-${i}`,
    input: {
      partnered, familyIncome,
      participationHours: { adult1: pick([0, 16, 48, 49, 60, 76]), adult2: partnered ? pick([0, 16, 48, 49, 60, 76]) : null },
      applyWithholding: false, children,
    },
    expected: {},
    skip: true,
  });
}
return cases;
}

if (process.argv[1] && process.argv[1].endsWith('generate-cases.mjs')) {
  writeFileSync(process.stdout.fd, JSON.stringify(generateCases(Number(process.argv[2] ?? 1000)), null, 2));
}
