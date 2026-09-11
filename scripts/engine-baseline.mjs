/**
 * Offline baseline + switch sensitivity.
 *
 *   npm run baseline
 *
 * Runs every edge case through the engine and writes reports/engine-baseline.md:
 *
 *   1. What the engine returns for each case, as a worksheet with empty columns
 *      for the StartingBlocks figures. Fill those in by hand if the automated
 *      comparison cannot reach the site.
 *   2. Which of the three switches actually moves each case, and by how much.
 *      That is the search space for step 8: a case no switch moves can never be
 *      fixed by a switch, so a difference there is an input-mapping or logic
 *      question, not rounding.
 *
 * This proves nothing about StartingBlocks on its own — it has no access to it.
 * It narrows where to look once the live figures exist.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { calculateCcs } from '../src/ccsEngine';
import { CCS_RATES, CURRENT_CCS_YEAR } from '../src/ccsRates';
import { edgeCases } from './edge-cases.mjs';

const MODES = ['nearest', 'down', 'none'];
const rates = CCS_RATES[CURRENT_CCS_YEAR];
const original = { ...rates.percentRounding };

function runUnder(input, mode, withholding) {
  rates.percentRounding = { decimals: 2, mode };
  try {
    return calculateCcs({ ...input, applyWithholding: withholding });
  } finally {
    rates.percentRounding = { ...original };
  }
}

const f2 = n => (n == null ? '—' : n.toFixed(2));

const cases = edgeCases();
const rows = [];

for (const c of cases) {
  const base = runUnder(c.input, original.mode, false);
  const variants = {};
  for (const mode of MODES) {
    for (const wh of [false, true]) {
      const r = runUnder(c.input, mode, wh);
      variants[`${mode}/${wh ? 'withheld' : 'gross'}`] = {
        weekSub: r.totals.perWeek.paidSubsidy,
        weekOop: r.totals.perWeek.outOfPocket,
        pct: r.children.map(x => x.ccsPercent).join('/'),
      };
    }
  }
  const baseKey = `${original.mode}/gross`;
  const movedBy = Object.entries(variants)
    .filter(([k, v]) => k !== baseKey &&
      (Math.abs(v.weekSub - variants[baseKey].weekSub) > 0.004 ||
       Math.abs(v.weekOop - variants[baseKey].weekOop) > 0.004))
    .map(([k, v]) => `${k} ${v.weekSub >= variants[baseKey].weekSub ? '+' : ''}${(v.weekSub - variants[baseKey].weekSub).toFixed(2)}`);

  rows.push({
    name: c.name,
    income: c.input.familyIncome,
    kids: c.input.children.length,
    pct: base.children.map(x => `${x.ccsPercent}${x.rateType === 'higher' ? 'H' : ''}`).join(' / '),
    hrs: base.entitledHoursPerFortnight,
    subsidised: base.children.map(x => x.subsidisedHoursPerFortnight).join('/'),
    weekFee: base.totals.perWeek.fees,
    weekSub: base.totals.perWeek.subsidy,
    weekOop: base.totals.perWeek.outOfPocket,
    fnOop: base.totals.perFortnight.outOfPocket,
    movedBy,
  });
}

const sensitive = rows.filter(r => r.movedBy.length);
const roundingOnly = rows.filter(r =>
  r.movedBy.some(m => m.startsWith('down/gross') || m.startsWith('none/gross')));

// Magnitude of each switch, used in the report below.
let maxRounding = 0, minWh = Infinity, maxWh = 0;
for (const c of cases) {
  const gross = runUnder(c.input, original.mode, false).totals.perWeek;
  for (const mode of MODES) {
    const d = Math.abs(runUnder(c.input, mode, false).totals.perWeek.subsidy - gross.subsidy);
    if (d > maxRounding) maxRounding = d;
  }
  const wh = gross.subsidy - runUnder(c.input, original.mode, true).totals.perWeek.paidSubsidy;
  if (wh > 0) { minWh = Math.min(minWh, wh); maxWh = Math.max(maxWh, wh); }
}
if (!isFinite(minWh)) minWh = 0;

mkdirSync('reports', { recursive: true });
writeFileSync('reports/engine-baseline.md', [
  `# Engine baseline — ${new Date().toISOString().slice(0, 10)}`,
  '',
  `CCS year ${CURRENT_CCS_YEAR}. ${rows.length} edge cases. Switch settings as checked in:`,
  `\`percentRounding = { decimals: ${original.decimals}, mode: '${original.mode}' }\`, \`applyWithholding = false\`.`,
  '',
  '## 1. Worksheet',
  '',
  'What the engine returns, with blank columns for the StartingBlocks figures.',
  '`H` marks a child on the higher rate.',
  '',
  '| Case | Income | CCS % | Entitled hrs/fn | Subsidised hrs | Our wk fee | Our wk subsidy | Our wk pay | Our fn pay | SB wk subsidy | SB wk pay | Δ |',
  '|---|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map(r => `| ${r.name} | ${r.income.toLocaleString()} | ${r.pct} | ${r.hrs} | ${r.subsidised} | ${f2(r.weekFee)} | ${f2(r.weekSub)} | ${f2(r.weekOop)} | ${f2(r.fnOop)} |  |  |  |`),
  '',
  '## 2. Switch sensitivity',
  '',
  `${sensitive.length} of ${rows.length} cases change under at least one switch setting.`,
  `${rows.length - sensitive.length} are identical under all six combinations — for those, any`,
  'difference against StartingBlocks is an input-mapping or logic question, and no',
  'rounding or withholding setting will close it.',
  '',
  `Rounding mode alone (withholding off) moves ${roundingOnly.length} cases.`,
  '',
  '| Case | Moved by (Δ weekly subsidy vs checked-in settings) |',
  '|---|---|',
  ...(sensitive.length
    ? sensitive.map(r => `| ${r.name} | ${r.movedBy.join(' · ')} |`)
    : ['| _none_ | no case is sensitive to any switch |']),
  '',
  '## 3. Signature of each switch',
  '',
  'The two switches leave very different sized footprints, which makes a live',
  'difference easy to attribute:',
  '',
  `- **Rounding mode** never moves weekly subsidy by more than $${maxRounding.toFixed(2)} in any case here.`,
  '  It only bites where the taper lands on a fraction of a percent.',
  `- **Withholding** always removes exactly 5% of the subsidy — $${minWh.toFixed(2)} to $${maxWh.toFixed(2)} a week`,
  '  across these cases. A difference that is 5% of the subsidy is the withholding',
  '  switch, never rounding.',
  '',
  'So: a difference of a few cents is a rounding question; a difference that is',
  'proportional to the subsidy is a withholding question; anything else is neither.',
  '',
  `The sharpest test of rounding mode is **income $88,521** — one dollar over the`,
  'first threshold. The exact percentage is 89.9998, so `nearest` shows 90.00% and',
  '`down` shows 89.99%. Whatever StartingBlocks displays there settles the mode on',
  'its own.',
  '',
  '## 4. How to read this once live figures exist',
  '',
  '- Difference is cents **and** the case appears in section 2 → try the setting named there.',
  '- Difference is cents and the case is **not** in section 2 → not a rounding question.',
  '  Look at the hourly cap and the order children were entered.',
  '- Difference is whole dollars → input mapping. Check, in order: session hours per day,',
  '  days entered per week vs per fortnight, and which child the page put on the higher rate.',
  '',
].join('\n'));

console.log(`Wrote reports/engine-baseline.md — ${rows.length} cases, ${sensitive.length} switch-sensitive.`);
