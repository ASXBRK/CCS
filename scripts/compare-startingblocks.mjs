/**
 * Automated side-by-side: our engine vs StartingBlocks.gov.au.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run compare -- [n=200] [--headed] [--dump]
 *
 * Writes:
 *   tests/golden-cases.json      — cases with StartingBlocks' displayed figures (feeds `npm run golden`)
 *   reports/comparison.md        — human-readable pass/fail table with diffs
 *   reports/comparison.csv
 *   reports/dom-dump.md          — with --dump: every control the form exposes, step by step
 *
 * --dump is the tool to reach for when selectors drift. It walks the form
 * without filling anything and records the role, accessible name, tag, type
 * and options of every control on every step. Feed that to whoever is fixing
 * the matchers below; it turns a blind guess into a lookup.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { calculateCcs } from '../src/ccsEngine';
import { generateCases } from './generate-cases.mjs';
import { edgeCases } from './edge-cases.mjs';

const URL = 'https://www.startingblocks.gov.au/child-care-subsidy-calculator';
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const N = Number(ARGS[0] ?? 200);
const HEADED = process.argv.includes('--headed');
const DUMP = process.argv.includes('--dump');
const TOL = 0.01;

// ---------------------------------------------------------------------------
// Field matchers.
//
// Everything the form asks for is matched on its VISIBLE TEXT, not on CSS
// classes or generated ids — a Next.js build regenerates those on every
// deploy, wording survives. Each entry is a list of alternatives tried in
// order. If StartingBlocks rewords a question, add the new wording here and
// nothing else needs to change.
// ---------------------------------------------------------------------------
const M = {
  start:        [/get started/i, /start( the)? calculator/i, /calculate/i, /begin/i],
  next:         [/^next$/i, /^continue$/i, /next step/i, /^done$/i, /see (my )?(results|estimate)/i, /calculate/i],
  income:       [/combined.*family.*income/i, /family.*income/i, /taxable income/i, /household income/i],
  partnered:    [/partner/i, /couple/i, /two parents/i],
  single:       [/single/i, /no partner/i, /one parent/i, /sole parent/i],
  activity:     [/hours.*(activity|work|study)/i, /(activity|work|recognised).*hours/i, /how many hours/i],
  activity2:    [/partner.*hours/i, /second.*(adult|parent).*hours/i, /hours.*partner/i],
  childAge:     [/age of (the |your )?child/i, /child.*age/i, /how old/i],
  schoolAge:    [/school/i],
  careType:     [/type of (child ?care|care)/i, /care type/i, /service type/i],
  dailyFee:     [/(daily|per day).*fee/i, /fee.*(per day|each day|daily)/i, /session fee/i, /cost.*per day/i],
  hourlyFee:    [/(hourly|per hour).*fee/i, /fee.*(per hour|an hour|hourly)/i, /rate per hour/i],
  hoursPerDay:  [/hours.*(per|each) (day|session)/i, /session length/i, /length of.*session/i],
  days:         [/days.*(per|each) (week|fortnight)/i, /how many days/i, /number of days/i],
  addChild:     [/add (another |a )?child/i, /another child/i],
  // Result readouts
  resSubsidy:   [/subsidy/i, /government.*(pay|contribut)/i, /ccs.*amount/i],
  resOop:       [/out of pocket/i, /you(r)? (will )?pay/i, /gap fee/i, /your cost/i],
  resFees:      [/total fee/i, /full fee/i, /child ?care fee/i],
  resPercent:   [/subsidy (rate|percentage)/i, /ccs (rate|percentage)/i, /your rate/i, /% ?subsidy/i],
};

const CARE_LABEL = {
  CBDC: [/centre ?based/i, /long day care/i, /day care centre/i],
  FDC:  [/family day care/i],
  OSHC: [/outside school hours/i, /oshc/i, /before.*after school/i, /vacation care/i],
  IHC:  [/in ?home care/i],
};

// ---------- low-level helpers -------------------------------------------------

const money = t => {
  const m = String(t).replace(/,/g, '').match(/-?\$?\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};
const pct = t => {
  const m = String(t).match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? Number(m[1]) : null;
};

/** Every visible, enabled control on the current step, with its accessible name. */
async function controls(page) {
  return page.evaluate(() => {
    const vis = el => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const name = el => {
      const by = id => (id ? document.getElementById(id)?.innerText : '') || '';
      let n = el.getAttribute('aria-label') || by(el.getAttribute('aria-labelledby')) ||
              (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)?.innerText : '') ||
              el.closest('label')?.innerText || el.getAttribute('placeholder') || el.name || '';
      if (!n.trim()) {
        // fall back to the nearest preceding heading or paragraph
        let p = el.parentElement, hops = 0;
        while (p && hops++ < 4) {
          const t = [...p.querySelectorAll('label,legend,h1,h2,h3,h4,p')].map(x => x.innerText).find(Boolean);
          if (t && t.trim()) { n = t; break; }
          p = p.parentElement;
        }
      }
      return n.replace(/\s+/g, ' ').trim().slice(0, 160);
    };
    // Stamp each control so a Playwright locator can address exactly the element
    // we inspected. Indexing a fresh locator would not line up: it would also
    // count the hidden and disabled controls filtered out here.
    for (const el of document.querySelectorAll('[data-cmp-idx]')) el.removeAttribute('data-cmp-idx');
    return [...document.querySelectorAll('input,select,textarea,button,[role="radio"],[role="button"],[role="combobox"]')]
      .filter(vis).filter(el => !el.disabled)
      .map((el, i) => {
        el.setAttribute('data-cmp-idx', String(i));
        return {
          i, tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '',
          name: name(el), value: el.value ?? '',
          options: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()) : undefined,
        };
      });
  });
}

const hit = (text, pats) => pats.some(p => p.test(text || ''));

/** Nth control matching `pats` with one of the given tag/type shapes. */
function find(ctrls, pats, want) {
  return ctrls.filter(c => want(c)).find(c => hit(c.name, pats)) ?? null;
}

function handleOf(page, ctrl) {
  return page.locator(`[data-cmp-idx="${ctrl.i}"]`).first();
}

async function typeInto(page, ctrl, value) {
  const h = handleOf(page, ctrl);
  await h.scrollIntoViewIfNeeded().catch(() => {});
  await h.fill('');
  await h.fill(String(value));
  await h.blur().catch(() => {});
}

async function selectMatching(page, ctrl, pats) {
  const h = handleOf(page, ctrl);
  const idx = (ctrl.options ?? []).findIndex(o => hit(o, pats));
  if (idx < 0) return false;
  await h.selectOption({ index: idx });
  return true;
}

/** Click the first thing on the page whose text matches, radio/button/link alike. */
async function clickText(page, pats, { timeout = 4000 } = {}) {
  for (const p of pats) {
    for (const role of ['button', 'radio', 'link', 'tab', 'checkbox']) {
      const l = page.getByRole(role, { name: p }).first();
      if (await l.count().then(n => n > 0).catch(() => false)) {
        try { await l.click({ timeout }); return true; } catch { /* keep looking */ }
      }
    }
    const t = page.getByText(p).first();
    if (await t.count().then(n => n > 0).catch(() => false)) {
      try { await t.click({ timeout }); return true; } catch { /* keep looking */ }
    }
  }
  return false;
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(250);
}

// ---------- results -----------------------------------------------------------

/**
 * Read the results panel. Pulls every "label: $amount" pair the page shows,
 * tags each with the period its surrounding text names, and returns only what
 * was actually on screen. Nothing here calculates — a figure the page does not
 * display comes back null.
 */
async function readResults(page) {
  const blocks = await page.evaluate(() => {
    const vis = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    const out = [];
    for (const el of document.querySelectorAll('li,tr,p,div,span,dd,dt,h2,h3,h4,strong')) {
      if (!vis(el)) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 220) continue;
      if (!/[$%]/.test(t)) continue;
      // include the nearest heading so "per week" / "per fortnight" context survives
      let ctx = '', p = el.parentElement, hops = 0;
      while (p && hops++ < 5) {
        const h = [...p.querySelectorAll('h1,h2,h3,h4,legend,th,caption')].map(x => x.innerText).filter(Boolean).join(' ');
        if (h) { ctx = h.replace(/\s+/g, ' ').trim().slice(0, 200); break; }
        p = p.parentElement;
      }
      out.push({ text: t, ctx });
    }
    return out;
  });

  const period = s =>
    /fortnight|fortnightly|per 2 weeks|每/i.test(s) ? 'perFortnight'
    : /per week|weekly|a week|\/wk|\/week/i.test(s) ? 'perWeek'
    : /per year|annual|yearly|pa\b/i.test(s) ? 'perYear'
    : null;

  const res = { perWeek: {}, perFortnight: {}, perYear: {}, ccsPercent: null };
  for (const b of blocks) {
    const whole = `${b.ctx} ${b.text}`;
    const per = period(b.text) ?? period(b.ctx);
    if (res.ccsPercent == null && hit(whole, M.resPercent)) {
      const p = pct(b.text);
      if (p != null) res.ccsPercent = p;
    }
    if (!per) continue;
    const amt = money(b.text);
    if (amt == null) continue;
    const key = hit(whole, M.resOop) ? 'outOfPocket'
              : hit(whole, M.resSubsidy) ? 'subsidy'
              : hit(whole, M.resFees) ? 'fees' : null;
    if (key && res[per][key] == null) res[per][key] = amt;
  }

  for (const p of ['perWeek', 'perFortnight', 'perYear']) {
    if (!Object.keys(res[p]).length) delete res[p];
  }
  const got = ['perWeek', 'perFortnight', 'perYear'].some(p => res[p]);
  return got ? res : null;
}

async function resultsVisible(page) {
  const r = await readResults(page);
  return r != null;
}

// ---------- the form walk -----------------------------------------------------

/**
 * Enter `input` into the StartingBlocks form and return what the page shows.
 *
 * The form is a multi-step wizard, so this does not assume a field order.
 * It looks at whatever step is on screen, fills every field it recognises,
 * presses Next, and repeats until the results panel appears. A field the step
 * does not show is simply not filled on that pass.
 *
 * READ ONLY. Every number returned is scraped from the page.
 */
async function fillAndRead(page, input) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle(page);
  await clickText(page, M.start).catch(() => {});
  await settle(page);

  const filled = new Set();
  // A field is weekly only if it says "week" and does not say "fortnight".
  const perWeekField = c => /week/i.test(c.name) && !/fortnight/i.test(c.name);
  const isText = c => c.tag === 'input' && /^(text|number|tel|)$/.test(c.type);
  const isSelect = c => c.tag === 'select';
  const isAny = c => isText(c) || isSelect(c);

  for (let step = 0; step < 24; step++) {
    if (await resultsVisible(page)) break;
    const ctrls = await controls(page);
    let did = false;

    // --- family income
    if (!filled.has('income')) {
      const c = find(ctrls, M.income, isText);
      if (c) { await typeInto(page, c, Math.round(input.familyIncome)); filled.add('income'); did = true; }
    }

    // --- single / partnered
    if (!filled.has('partnered')) {
      if (await clickText(page, input.partnered ? M.partnered : M.single, { timeout: 1500 })) {
        filled.add('partnered'); did = true;
      }
    }

    // --- activity hours
    // Our input is hours per FORTNIGHT. The form may ask per week. As with
    // days, the field's own wording decides — never assume the unit.
    const putHours = async (ctrl, hoursPerFortnight) => {
      const v = perWeekField(ctrl) ? hoursPerFortnight / 2 : hoursPerFortnight;
      if (isSelect(ctrl)) return selectMatching(page, ctrl, [new RegExp(`\\b${v}\\b`)]);
      await typeInto(page, ctrl, v);
      return true;
    };
    if (!filled.has('activity')) {
      const a1 = find(ctrls, M.activity, isAny);
      if (a1) { await putHours(a1, input.participationHours.adult1); filled.add('activity'); did = true; }
    }
    if (input.partnered && input.participationHours.adult2 != null && !filled.has('activity2')) {
      const a2 = find(ctrls, M.activity2, isAny);
      if (a2) { await putHours(a2, input.participationHours.adult2); filled.add('activity2'); did = true; }
    }

    // --- children
    for (let ci = 0; ci < input.children.length; ci++) {
      const ch = input.children[ci];
      const k = s => `child${ci}:${s}`;
      if (ci > 0 && !filled.has(k('added'))) {
        if (await clickText(page, M.addChild, { timeout: 1500 })) { filled.add(k('added')); did = true; await settle(page); }
      }
      const cur = await controls(page);
      const nth = (pats, want) => cur.filter(want).filter(c => hit(c.name, pats))[ci] ?? null;

      if (!filled.has(k('age'))) {
        const c = nth(M.childAge, isAny);
        if (c) {
          if (isSelect(c)) await selectMatching(page, c, [new RegExp(`\\b${ch.ageYears}\\b`)]);
          else await typeInto(page, c, ch.ageYears);
          filled.add(k('age')); did = true;
        }
      }
      if (!filled.has(k('care'))) {
        const c = nth(M.careType, isSelect);
        if (c && await selectMatching(page, c, CARE_LABEL[ch.careType])) { filled.add(k('care')); did = true; }
        else if (await clickText(page, CARE_LABEL[ch.careType], { timeout: 1500 })) { filled.add(k('care')); did = true; }
      }
      if (!filled.has(k('fee'))) {
        // Some versions of the form ask for an hourly fee rather than a daily
        // one. Fill whichever it shows, converting only when the form's own
        // wording says hourly.
        const cd = nth(M.dailyFee, isText);
        const chr = nth(M.hourlyFee, isText);
        if (cd) { await typeInto(page, cd, ch.dailyFee ?? ''); filled.add(k('fee')); did = true; }
        else if (chr) {
          const hourly = ch.hourlyFee ?? (ch.dailyFee != null && ch.hoursPerDay > 0 ? ch.dailyFee / ch.hoursPerDay : '');
          await typeInto(page, chr, typeof hourly === 'number' ? Math.round(hourly * 100) / 100 : hourly);
          filled.add(k('fee')); did = true;
        }
      }
      if (!filled.has(k('hours'))) {
        const c = nth(M.hoursPerDay, isAny);
        if (c) {
          if (isSelect(c)) await selectMatching(page, c, [new RegExp(`\\b${ch.hoursPerDay}\\b`)]);
          else await typeInto(page, c, ch.hoursPerDay);
          filled.add(k('hours')); did = true;
        }
      }
      if (!filled.has(k('days'))) {
        const c = nth(M.days, isAny);
        if (c) {
          // The form may ask per WEEK or per FORTNIGHT. Decide from its own
          // wording, never from a guess: the label is the only authority.
          const v = perWeekField(c) ? ch.daysPerFortnight / 2 : ch.daysPerFortnight;
          if (isSelect(c)) await selectMatching(page, c, [new RegExp(`\\b${v}\\b`)]);
          else await typeInto(page, c, v);
          filled.add(k('days')); did = true;
        }
      }
    }

    const advanced = await clickText(page, M.next, { timeout: 2500 });
    await settle(page);
    if (!advanced && !did) break; // nothing recognised and nowhere to go
  }

  await settle(page);
  const out = await readResults(page);
  if (!out) {
    const seen = (await controls(page)).map(c => `${c.tag}[${c.type}] "${c.name}"`).slice(0, 12).join(' | ');
    throw new Error(`no results panel found; controls on screen: ${seen || '(none)'}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
async function launch() {
  const opts = { headless: !HEADED };
  try {
    return await chromium.launch(opts);
  } catch (e) {
    // Sandboxes often ship one pre-installed Chromium that does not match the
    // build this Playwright pins. Use it rather than downloading another.
    const fallback = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
    if (!existsSync(fallback)) throw e;
    console.warn(`playwright's own chromium is missing; using ${fallback}`);
    return await chromium.launch({ ...opts, executablePath: fallback });
  }
}

/** Fail fast and legibly when the host cannot be reached at all. */
async function preflight(page) {
  try {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    return null;
  } catch (e) {
    return e.message.split('\n')[0];
  }
}

async function dumpForm(page) {
  const steps = [];
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await settle(page);
  await clickText(page, M.start).catch(() => {});
  await settle(page);
  for (let i = 0; i < 12; i++) {
    const ctrls = await controls(page);
    const heading = await page.locator('h1,h2,legend').first().innerText().catch(() => '');
    steps.push({ i, heading: heading.replace(/\s+/g, ' ').trim(), ctrls });
    if (await resultsVisible(page)) break;
    if (!(await clickText(page, M.next, { timeout: 2500 }))) break;
    await settle(page);
  }
  mkdirSync('reports', { recursive: true });
  const md = ['# StartingBlocks form dump', '', `Captured ${new Date().toISOString()}`, '',
    ...steps.flatMap(s => [
      `## Step ${s.i}${s.heading ? ` — ${s.heading}` : ''}`, '',
      '| # | tag | type | accessible name | options |', '|---:|---|---|---|---|',
      ...s.ctrls.map(c => `| ${c.i} | ${c.tag} | ${c.type} | ${(c.name || '').replace(/\|/g, '\\|')} | ${(c.options ?? []).join(' · ').replace(/\|/g, '\\|')} |`),
      '',
    ])].join('\n');
  writeFileSync('reports/dom-dump.md', md);
  console.log(`Wrote reports/dom-dump.md (${steps.length} steps).`);
}

async function main() {
  const browser = await launch();
  const page = await browser.newPage();

  const blocked = await preflight(page);
  if (blocked) {
    await browser.close();
    console.error(
      `\nCannot reach ${URL}\n  ${blocked}\n\n` +
      `The comparison needs live access to StartingBlocks. If this is a sandbox with\n` +
      `an egress allow-list, run it somewhere the host is reachable — nothing else\n` +
      `about the harness changes.\n`);
    process.exit(2);
  }

  if (DUMP) { await dumpForm(page); await browser.close(); return; }

  const cases = [...edgeCases(), ...generateCases(Math.max(0, N - 40))];
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
        if (sb) {
      // Only pin a displayed percentage to a child when there is exactly one.
      // With two or more, the page may be showing the higher-rate child's rate
      // and attributing it to child-1 would bake a wrong expectation into the
      // golden file.
      const single = c.input.children.length === 1 && sb.ccsPercent != null;
      golden.push({
        name: c.name, input: c.input,
        expected: {
          perWeek: sb.perWeek, perFortnight: sb.perFortnight,
          children: single ? [{ id: c.input.children[0].id, ccsPercent: sb.ccsPercent }] : undefined,
        },
        tolerance: TOL,
      });
    }
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
