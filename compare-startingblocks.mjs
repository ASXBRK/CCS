/**
 * Automated side-by-side: our engine vs StartingBlocks.gov.au.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npx tsx scripts/compare-startingblocks.mjs [n=200] [--headed]
 *
 * Writes:
 *   tests/golden-cases.json      — cases with StartingBlocks' displayed figures (feeds `npm run golden`)
 *   reports/comparison.md        — human-readable pass/fail table with diffs
 *   reports/comparison.csv
 *
 * ONE PART IS DELIBERATELY LEFT FOR CLAUDE CODE: `fillAndRead(page, input)`.
 * The StartingBlocks form is a multi-step Next.js UI whose selectors are not
 * known from outside the browser. Claude Code should open the page, inspect
 * the DOM, and implement that function. Everything else is done.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { calculateCcs } from '../src/ccsEngine';
import { generateCases } from './generate-cases.mjs';

const URL = 'https://www.startingblocks.gov.au/child-care-subsidy-calculator';
const N = Number(process.argv[2] ?? 200);
const HEADED = process.argv.includes('--headed');
const TOL = 0.01;

// ---------------------------------------------------------------------------
// TODO(Claude Code): implement against the live DOM.
// Contract: enter every field of `input` into the StartingBlocks form, submit,
// and return the numbers the page displays. Return null for any figure the
// page does not show. Do not compute anything here; only read the page.
// ---------------------------------------------------------------------------
async function fillAndRead(page, input) {
  // Suggested approach:
  //  1. page.goto(URL); click "Get started".
  //  2. Family income input; single/partnered; activity hours for each adult.
  //  3. For each child: age / school status, care type, daily fee, hours, days.
  //     Note StartingBlocks may ask days per WEEK — convert daysPerFortnight / 2.
  //  4. Submit, wait for the results panel, read weekly and fortnightly
  //     subsidy and out-of-pocket, and the CCS % if shown.
  throw new Error('fillAndRead not implemented yet — see TODO');
  // return { perWeek: { subsidy, outOfPocket }, perFortnight: { subsidy, outOfPocket }, ccsPercent };
}

// ---------------------------------------------------------------------------
function edgeCases() {
  const child = (o) => ({ id: 'child-1', ageYears: 3, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6, ...o });
  const fam = (o) => ({ partnered: true, participationHours: { adult1: 76, adult2: 76 }, applyWithholding: false, ...o });
  const incomes = [0, 88519, 88520, 88521, 146436, 146437, 146438, 191436, 191437, 270726, 270727, 360726, 370725, 370726, 538519, 538520, 538521];
  const cases = [];
  for (const i of incomes) cases.push({ name: `edge income ${i} one child`, input: fam({ familyIncome: i, children: [child()] }) });
  for (const i of [100000, 150000, 200000, 300000, 365000, 371000]) cases.push({ name: `edge income ${i} two under 6`, input: fam({ familyIncome: i, children: [child({ id: 'child-1', ageYears: 4 }), child({ id: 'child-2', ageYears: 1 })] }) });
  cases.push({ name: 'edge fee below cap', input: fam({ familyIncome: 120000, children: [child({ dailyFee: 120 })] }) });
  cases.push({ name: 'edge fee at cap', input: fam({ familyIncome: 120000, children: [child({ dailyFee: 151.9 })] }) });
  cases.push({ name: 'edge fee above cap', input: fam({ familyIncome: 120000, children: [child({ dailyFee: 200 })] }) });
  cases.push({ name: 'edge participation 48 → 72 hrs', input: fam({ familyIncome: 120000, participationHours: { adult1: 76, adult2: 48 }, children: [child({ daysPerFortnight: 10 })] }) });
  cases.push({ name: 'edge participation 49 → 100 hrs', input: fam({ familyIncome: 120000, participationHours: { adult1: 76, adult2: 49 }, children: [child({ daysPerFortnight: 10 })] }) });
  cases.push({ name: 'edge single parent', input: fam({ partnered: false, participationHours: { adult1: 30, adult2: null }, familyIncome: 70000, children: [child()] }) });
  cases.push({ name: 'edge school-age OSHC', input: fam({ familyIncome: 120000, children: [child({ ageYears: 8, schoolAge: true, careType: 'OSHC', dailyFee: 30, hoursPerDay: 3, daysPerFortnight: 10 })] }) });
  cases.push({ name: 'edge FDC', input: fam({ familyIncome: 120000, children: [child({ careType: 'FDC', dailyFee: 130 })] }) });
  cases.push({ name: 'edge 12hr session over 100 hrs', input: fam({ familyIncome: 120000, children: [child({ hoursPerDay: 12, daysPerFortnight: 10 })] }) });
  cases.push({ name: 'edge three children mixed', input: fam({ familyIncome: 180000, children: [child({ ageYears: 7, schoolAge: true, careType: 'OSHC', dailyFee: 30, hoursPerDay: 3 }), child({ id: 'child-2', ageYears: 4 }), child({ id: 'child-3', ageYears: 1 })] }) });
  return cases;
}

async function main() {
  const cases = [...edgeCases(), ...generateCases(Math.max(0, N - 40))];
  const browser = await chromium.launch({ headless: !HEADED });
  const page = await browser.newPage();
  const rows = [], golden = [];

  for (const c of cases) {
    const ours = calculateCcs(c.input);
    let sb, error = null;
    try { sb = await fillAndRead(page, c.input); } catch (e) { error = String(e.message); sb = null; }
    const cmp = (o, s) => (s == null ? null : Math.round((o - s) * 100) / 100);
    const row = {
      name: c.name, error,
      ourWeekSub: ours.totals.perWeek.subsidy, sbWeekSub: sb?.perWeek?.subsidy ?? null,
      ourWeekOop: ours.totals.perWeek.outOfPocket, sbWeekOop: sb?.perWeek?.outOfPocket ?? null,
      ourFnOop: ours.totals.perFortnight.outOfPocket, sbFnOop: sb?.perFortnight?.outOfPocket ?? null,
      ourPct: ours.standardPercent, sbPct: sb?.ccsPercent ?? null,
    };
    row.dWeekSub = cmp(row.ourWeekSub, row.sbWeekSub); row.dWeekOop = cmp(row.ourWeekOop, row.sbWeekOop); row.dFnOop = cmp(row.ourFnOop, row.sbFnOop);
    row.pass = !error && [row.dWeekSub, row.dWeekOop, row.dFnOop].every(d => d === null || Math.abs(d) <= TOL);
    rows.push(row);
    if (sb) golden.push({ name: c.name, input: c.input, expected: { perWeek: sb.perWeek, perFortnight: sb.perFortnight, children: sb.ccsPercent != null ? [{ id: c.input.children[0].id, ccsPercent: sb.ccsPercent }] : undefined }, tolerance: TOL });
    process.stdout.write(`${row.pass ? 'PASS' : 'FAIL'} ${c.name}${error ? ' — ' + error : ''}\n`);
  }
  await browser.close();

  mkdirSync('reports', { recursive: true });
  writeFileSync('tests/golden-cases.json', JSON.stringify(golden, null, 2));
  const fails = rows.filter(r => !r.pass);
  const md = [
    `# StartingBlocks comparison — ${new Date().toISOString().slice(0, 10)}`, '',
    `${rows.length} cases, ${rows.length - fails.length} pass, ${fails.length} fail (tolerance $${TOL}).`, '',
    '| Case | Our wk subsidy | SB wk subsidy | Δ | Our wk pay | SB wk pay | Δ | Our fn pay | SB fn pay | Δ | Result |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...rows.map(r => `| ${r.name} | ${r.ourWeekSub} | ${r.sbWeekSub ?? '—'} | ${r.dWeekSub ?? '—'} | ${r.ourWeekOop} | ${r.sbWeekOop ?? '—'} | ${r.dWeekOop ?? '—'} | ${r.ourFnOop} | ${r.sbFnOop ?? '—'} | ${r.dFnOop ?? '—'} | ${r.error ? 'ERROR' : r.pass ? 'pass' : 'FAIL'} |`),
  ].join('\n');
  writeFileSync('reports/comparison.md', md);
  writeFileSync('reports/comparison.csv', [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).join(','))].join('\n'));
  console.log(`\n${rows.length - fails.length}/${rows.length} pass. Report: reports/comparison.md`);
  process.exit(fails.length ? 1 : 0);
}
main();
