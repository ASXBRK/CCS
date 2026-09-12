/**
 * Automated side-by-side: our engine vs StartingBlocks.gov.au.
 *
 *   npm i -D playwright && npx playwright install chromium
 *   npm run compare -- [n=200] [--headed] [--dump]
 *                      [--jobs=3] [--budget=SECONDS] [--fresh]
 *
 * A full run takes most of an hour, so it is resumable: re-running the same
 * command picks up where the last one stopped. `--budget=480` stops pulling new
 * cases after eight minutes and exits 3, which is how a long run is driven in
 * bounded chunks. `--fresh` throws the saved state away and starts over.
 * Exit codes: 0 all pass, 1 complete with failures, 2 site unreachable,
 * 3 incomplete (resumable).
 *
 * Writes:
 *   tests/golden-cases.json      — cases with StartingBlocks' displayed figures (feeds `npm run golden`)
 *   reports/comparison.md        — human-readable pass/fail table with diffs
 *   reports/comparison.csv
 *   reports/comparison-cases.json — the generated case list, so a resume compares the same inputs
 *   reports/comparison-raw.jsonl  — one line per case already read off the site
 *   reports/dom-dump.md          — with --dump: every control the form exposes, step by step
 *
 * --dump is the tool to reach for when selectors drift. It records the role,
 * accessible name, tag, type and value of every control on the landing page,
 * the form and the results panel. It turns a blind guess into a lookup.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE LIVE FORM ACTUALLY LOOKS LIKE (verified 2026-09-11)
 * ---------------------------------------------------------------------------
 * It is NOT a multi-step wizard. It is a landing page with one "Get started"
 * button, then a SINGLE form page holding every question, then a results page.
 *
 * Everything below was read off the live DOM, not guessed:
 *   - family type          two radios, value="single" / value="partnered"
 *   - your participation   number, PER FORTNIGHT (default 76)
 *   - family income        text, comma-formatted (default 115,000)
 *   - partner participation  number, PER FORTNIGHT — only rendered when partnered
 *                          (default 0)
 *   - children             TABS. "Add another child" appends a tab; only the
 *                          selected child's fields are in the DOM, so children
 *                          must be filled one tab at a time. This is why the
 *                          old "nth matching control" walk could not work.
 *   - child age            number, whole years (default 2). There is NO
 *                          school-age question — the site derives it from age,
 *                          with the school-age cap starting at 6.
 *   - care type            four radios, value="centreBasedDayCare" /
 *                          "familyDayCare" / "outsideSchoolHoursCare" / "inHomeCare"
 *   - fee                  DAILY rate, number, accepts decimals (default 120)
 *   - session length       hours charged per day (default 8)
 *   - days                 PER FORTNIGHT (default 7)
 *   - submit               "Calculate subsidy"
 *
 * Both units the harness worried about (activity hours, days) are per
 * FORTNIGHT on the live form, which is what our engine takes. No conversion.
 *
 * The results page ALWAYS shows figures net of the 5% withholding, so every
 * case is run with applyWithholding: true (see WITHHOLDING below).
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { calculateCcs } from '../src/ccsEngine';
import { generateCases } from './generate-cases.mjs';
import { edgeCases } from './edge-cases.mjs';

const URL = 'https://www.startingblocks.gov.au/child-care-subsidy-calculator';
const ARGS = process.argv.slice(2).filter(a => !a.startsWith('--'));
const N = Number(ARGS[0] ?? 200);
const HEADED = process.argv.includes('--headed');
const DUMP = process.argv.includes('--dump');
const FRESH = process.argv.includes('--fresh');
const flag = (name, dflt) => {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : dflt;
};
/** Pages driven at once. Three is brisk without hammering a government site. */
const JOBS = flag('jobs', 3);
/** Stop pulling new cases after this long, so a run fits in a bounded window. */
const BUDGET_MS = flag('budget', 0) * 1000;
const TOL = 0.01;
const RETRIES = 3;

/**
 * A full run takes the better part of an hour, so it is written to survive being
 * cut short. Two files carry the state:
 *
 *   reports/comparison-cases.json   the case list, generated once and reused.
 *     generateCases() is random, so a resumed run would otherwise be comparing a
 *     different set of inputs than the one it is resuming.
 *   reports/comparison-raw.jsonl    one line per case already read off the site.
 *
 * Re-running picks up where it left off. `--fresh` discards both and starts over.
 */
const CASES_FILE = 'reports/comparison-cases.json';
const RAW_FILE = 'reports/comparison-raw.jsonl';

/**
 * WITHHOLDING. The results panel has no switch for this: it always reports
 * "What the Australian Government pays" net of the 5% Services Australia holds
 * back, and "What you pay" as fee minus that net figure. So the comparison
 * runs every case with withholding on, and the golden file records the inputs
 * that way, so `npm run golden` reproduces what the site displayed.
 */
const SITE_APPLIES_WITHHOLDING = true;

// ---------------------------------------------------------------------------
// Field matchers.
//
// Questions are matched on their VISIBLE WORDING, radios on their stable
// `value` attribute — never on CSS classes or generated ids, which a Next.js
// build regenerates on every deploy (the live ids look like `_r_11_-form-item`).
// Each entry is a list of alternatives tried in order: the exact live wording
// first, looser fallbacks after it, so a reword degrades instead of breaking.
// ---------------------------------------------------------------------------
const M = {
  start:        [/^get started$/i, /get started/i, /start( the)? calculator/i],
  submit:       [/^calculate subsidy$/i, /calculate subsidy/i, /^calculate$/i, /see (my )?(results|estimate)/i],
  addChild:     [/^add another child$/i, /add (another|a) child/i],
  selfHours:    [/recognised participation .*do you do per fortnight/i,
                 /how many hours of recognised participation/i,
                 /hours of (work|recognised)/i],
  partnerHours: [/does your partner do per fortnight/i,
                 /recognised activity does your partner/i,
                 /partner/i],
  income:       [/estimated annual income/i, /family'?s? .*income/i, /household income/i],
  childAge:     [/age of your child/i, /child'?s? age/i, /how old/i],
  dailyFee:     [/daily rate charged by your service/i, /daily rate/i, /(daily|per day).*(fee|rate)/i],
  hoursPerDay:  [/hours are you charged per day/i, /hours.*(per|each) (day|session)/i, /session length/i],
  days:         [/number of days your child will attend/i, /days.*(per|each) fortnight/i, /how many days/i],
};

/**
 * Care type. The radios carry a stable `value`; CARE_LABEL is the fallback for
 * clicking by visible text if the values ever change.
 */
const CARE_VALUE = {
  CBDC: 'centreBasedDayCare',
  FDC:  'familyDayCare',
  OSHC: 'outsideSchoolHoursCare',
  IHC:  'inHomeCare',
};
const CARE_LABEL = {
  CBDC: [/^centre based care$/i, /centre ?based/i, /long day care/i],
  FDC:  [/^family day care$/i, /family day care/i],
  OSHC: [/^out of school hours care$/i, /outside school hours/i, /oshc/i],
  IHC:  [/^in home care$/i, /in ?home care/i],
};

/** Rows of the results tables, by the label in their first cell. */
const ROW = {
  fees:      /your total service fee/i,
  rate:      /your ccs rate/i,
  govPays:   /what the australian government pays/i,
  withheld:  /^withholding$/i,
  youPay:    /what you pay/i,
};

// ---------- low-level helpers -------------------------------------------------

const hit = (text, pats) => pats.some(p => p.test(text || ''));
const money = t => {
  const m = String(t).replace(/,/g, '').match(/-?\$?\s*(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Every visible, enabled control on screen, with the question it belongs to.
 *
 * Each is stamped with `data-cmp-idx` so a Playwright locator addresses exactly
 * the element inspected here. Indexing a fresh locator would not line up: it
 * would also count the hidden and disabled controls filtered out below.
 */
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
        // fall back to the nearest enclosing label or legend
        let p = el.parentElement, hops = 0;
        while (p && hops++ < 4) {
          const t = [...p.querySelectorAll('label,legend')].map(x => x.innerText).find(Boolean);
          if (t && t.trim()) { n = t; break; }
          p = p.parentElement;
        }
      }
      return n.replace(/\s+/g, ' ').trim().slice(0, 180);
    };
    for (const el of document.querySelectorAll('[data-cmp-idx]')) el.removeAttribute('data-cmp-idx');
    return [...document.querySelectorAll('input,select,textarea,button')]
      .filter(vis).filter(el => !el.disabled)
      .map((el, i) => {
        el.setAttribute('data-cmp-idx', String(i));
        return {
          i, tag: el.tagName.toLowerCase(), type: el.type || el.getAttribute('role') || '',
          name: name(el), value: el.value ?? '',
          text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          options: el.tagName === 'SELECT' ? [...el.options].map(o => o.text.trim()) : undefined,
        };
      });
  });
}

const handleOf = (page, ctrl) => page.locator(`[data-cmp-idx="${ctrl.i}"]`).first();

/**
 * Put a number into a React-controlled input.
 *
 * `fill()` is not enough here: the income field reformats itself with commas on
 * every keystroke, and the number fields sit next to +/- steppers that re-read
 * state on change. Selecting all, deleting and typing drives the same events a
 * person would, which is what the form's state expects.
 */
async function typeInto(page, ctrl, value) {
  const h = handleOf(page, ctrl);
  await h.scrollIntoViewIfNeeded().catch(() => {});
  await h.click({ timeout: 8000 });
  await h.press('Control+a');
  await h.press('Delete');
  await h.type(String(value), { delay: 0 });
  await h.blur().catch(() => {});
  await page.waitForTimeout(40);
}

/** Click the first thing on the page whose accessible name or text matches. */
async function clickText(page, pats, { timeout = 6000 } = {}) {
  for (const p of pats) {
    const l = page.getByRole('button', { name: p }).first();
    if (await l.count().then(n => n > 0).catch(() => false)) {
      try { await l.click({ timeout }); return true; } catch { /* keep looking */ }
    }
  }
  const ctrls = await controls(page);
  const c = ctrls.find(x => hit(x.name, pats) || hit(x.text, pats));
  if (c) { try { await handleOf(page, c).click({ timeout }); return true; } catch { /* fall through */ } }
  return false;
}

/** The one control on screen whose question matches `pats`. */
function find(ctrls, pats, want = c => true) {
  for (const p of pats) {
    const c = ctrls.filter(want).find(x => p.test(x.name || ''));
    if (c) return c;
  }
  return null;
}

const isField = c => (c.tag === 'input' && /^(text|number|tel|)$/.test(c.type)) || c.tag === 'select';

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
}

// ---------- results -----------------------------------------------------------

/**
 * Read the results panel.
 *
 * The page renders one summary table (family totals) and, under "Full
 * breakdown", one table per child headed "Child N - Aged M". Every table has a
 * Weekly and a Fortnightly column, so the period comes from the column, not
 * from the row's wording.
 *
 * Nothing here calculates a subsidy. Two figures ARE summed from figures the
 * page displays, and both are noted where they are used:
 *   - gross subsidy  = "What the Australian Government pays" + "Withholding"
 *     (the page shows the net and the withheld amount, never the sum)
 *   - family fees    = the per-child "Your total service fee" rows
 *     (the summary table has no fee row)
 * A figure the page does not display comes back null.
 */
async function readResults(page) {
  const raw = await page.evaluate(() => {
    const parse = tb => {
      const rows = [];
      for (const tr of tb.querySelectorAll('tbody tr')) {
        const td = [...tr.children];
        if (td.length < 3) continue; // the repeated "Weekly | Fortnightly" header rows
        rows.push({
          label: (td[0].innerText || '').replace(/\s+/g, ' ').trim(),
          week: (td[1].innerText || '').trim(),
          fn: (td[2].innerText || '').trim(),
        });
      }
      return rows;
    };
    const tables = [...document.querySelectorAll('table')];
    const children = [];
    for (const h of document.querySelectorAll('h3')) {
      const m = (h.innerText || '').match(/Child\s+(\d+)\s*-\s*Aged\s+(\d+)/i);
      if (!m) continue;
      const tb = h.parentElement?.querySelector('table');
      if (tb) children.push({ n: Number(m[1]), age: Number(m[2]), rows: parse(tb) });
    }
    return { summary: tables.length ? parse(tables[0]) : [], children };
  });

  if (!raw.summary.length) return null;

  const cell = (rows, re, k) => {
    const r = rows.find(x => re.test(x.label));
    return r ? money(r[k]) : null;
  };
  const pctOf = rows => {
    const r = rows.find(x => ROW.rate.test(x.label));
    const m = r ? String(r.fn).match(/(\d+(?:\.\d+)?)\s*%/) : null;
    return m ? Number(m[1]) : null;
  };

  const out = { perWeek: {}, perFortnight: {}, children: [], ccsPercent: null };
  for (const [key, k] of [['perWeek', 'week'], ['perFortnight', 'fn']]) {
    const paid = cell(raw.summary, ROW.govPays, k);
    const withheld = cell(raw.summary, ROW.withheld, k);
    const oop = cell(raw.summary, ROW.youPay, k);
    const fees = raw.children.length
      ? raw.children.reduce((t, c) => t + (cell(c.rows, ROW.fees, k) ?? 0), 0)
      : null;
    out[key] = {
      fees: fees == null ? null : round2(fees),
      // gross = net + withheld; the page displays both halves but never the sum
      subsidy: paid == null || withheld == null ? null : round2(paid + withheld),
      paidSubsidy: paid, withheld, outOfPocket: oop,
    };
  }
  out.children = raw.children.map(c => ({
    n: c.n, age: c.age,
    displayedPercent: pctOf(c.rows),
    feePerFortnight: cell(c.rows, ROW.fees, 'fn'),
    paidSubsidyPerFortnight: cell(c.rows, ROW.govPays, 'fn'),
    withheldPerFortnight: cell(c.rows, ROW.withheld, 'fn'),
    outOfPocketPerFortnight: cell(c.rows, ROW.youPay, 'fn'),
  }));
  out.ccsPercent = out.children[0]?.displayedPercent ?? null;
  return out;
}

// ---------- the form walk -----------------------------------------------------

/**
 * Enter `input` into the StartingBlocks form and return what the page shows.
 *
 * Shape of the walk, which follows the real form (see the header comment):
 *   landing → "Get started" → one form page → "Calculate subsidy" → results.
 *
 * Children are TABS, so each child is selected and filled in turn; there is no
 * step in which two children's fields are on screen together.
 *
 * READ ONLY. Every number returned is scraped from the page.
 */
async function fillAndRead(page, input) {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (!(await clickText(page, M.start, { timeout: 20000 }))) {
    throw new Error('no "Get started" button on the landing page');
  }
  await page.waitForSelector('input[value="single"]', { timeout: 20000 });
  // Not settle(): this page never reaches networkidle, so waiting for it burns
  // the full timeout on every case. The form is already in the DOM by here.
  await page.waitForTimeout(150);

  // --- single / partnered. Radios carry a stable value attribute.
  const famBtn = page.locator(`button[value="${input.partnered ? 'partnered' : 'single'}"]`).first();
  if (await famBtn.count()) await famBtn.click();
  else if (!(await clickText(page, input.partnered ? [/^partnered$/i] : [/^single$/i])))
    throw new Error('no single/partnered control');
  await page.waitForTimeout(150);

  // --- participation hours. The live field says "per fortnight", which is the
  // unit our input already uses. Assert that rather than assume it: if the
  // wording ever changes to weekly, halve instead of feeding it a fortnight.
  const perWeekField = c => /week/i.test(c.name) && !/fortnight/i.test(c.name);
  const putHours = async (ctrl, hoursPerFortnight) =>
    typeInto(page, ctrl, perWeekField(ctrl) ? hoursPerFortnight / 2 : hoursPerFortnight);

  let ctrls = await controls(page);
  const self = find(ctrls, M.selfHours, isField);
  if (!self) throw new Error('no participation-hours field');
  await putHours(self, input.participationHours.adult1 ?? 0);

  ctrls = await controls(page);
  const inc = find(ctrls, M.income, isField);
  if (!inc) throw new Error('no income field');
  await typeInto(page, inc, Math.round(input.familyIncome));

  if (input.partnered) {
    ctrls = await controls(page);
    // the self field also matches loose "partner" wording, so exclude it by index
    const p2 = find(ctrls.filter(c => c.i !== self.i), M.partnerHours, isField);
    if (!p2) throw new Error('no partner participation field');
    await putHours(p2, input.participationHours.adult2 ?? 0);
  }

  // --- children. Add every tab first, then fill them one at a time.
  for (let i = 1; i < input.children.length; i++) {
    if (!(await clickText(page, M.addChild))) throw new Error(`could not add child ${i + 1}`);
    await page.waitForTimeout(250);
  }

  for (let i = 0; i < input.children.length; i++) {
    const ch = input.children[i];
    if (input.children.length > 1) {
      const tab = page.getByRole('button', { name: new RegExp(`^Child ${i + 1}$`) }).first();
      if (!(await tab.count())) throw new Error(`no tab for child ${i + 1}`);
      await tab.click();
      await page.waitForTimeout(250);
    }

    // Care type first: it decides which fee fields the panel renders.
    const careBtn = page.locator(`button[value="${CARE_VALUE[ch.careType]}"]`).first();
    if (await careBtn.count()) await careBtn.click();
    else if (!(await clickText(page, CARE_LABEL[ch.careType])))
      throw new Error(`no ${ch.careType} option`);
    await page.waitForTimeout(150);

    const fill = async (pats, value, what) => {
      const cs = await controls(page);
      const c = find(cs, pats, isField);
      if (!c) throw new Error(`child ${i + 1}: no ${what} field`);
      return { c, done: await typeInto(page, c, value) };
    };
    await fill(M.childAge, ch.ageYears, 'age');
    await fill(M.dailyFee, ch.dailyFee, 'daily fee');
    await fill(M.hoursPerDay, ch.hoursPerDay, 'session hours');

    // Days: per fortnight on the live form, which is our unit. Decide from the
    // field's own wording all the same — the label is the only authority.
    const cs = await controls(page);
    const dc = find(cs, M.days, isField);
    if (!dc) throw new Error(`child ${i + 1}: no days field`);
    await typeInto(page, dc, perWeekField(dc) ? ch.daysPerFortnight / 2 : ch.daysPerFortnight);
  }

  if (!(await clickText(page, M.submit))) throw new Error('no "Calculate subsidy" button');
  await page.waitForSelector('table', { timeout: 30000 });
  await page.waitForTimeout(300);

  const out = await readResults(page);
  if (!out) {
    const seen = (await controls(page)).map(c => `${c.tag}[${c.type}] "${c.name || c.text}"`).slice(0, 12).join(' | ');
    throw new Error(`no results tables found; controls on screen: ${seen || '(none)'}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
async function launch() {
  // A sandbox that routes egress through an HTTPS proxy has to tell Chromium
  // about it — Chromium does not read HTTPS_PROXY. Both accommodations are
  // inert when no proxy is configured:
  //   --proxy-server            point it at the proxy the shell already uses
  //   --ssl-version-max=tls1.2  some intercepting proxies reset the tunnel on a
  //     TLS 1.3 handshake from Chromium (curl and openssl negotiate 1.3 through
  //     the same proxy fine, so this is a Chromium/proxy interaction, not a
  //     policy block). 1.2 negotiates cleanly, still verifies the certificate
  //     against the proxy CA, and every host this script touches supports it.
  const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null;
  const args = ['--no-sandbox'];
  const opts = { headless: !HEADED, args };
  if (proxyUrl) {
    opts.proxy = { server: proxyUrl };
    args.push('--ssl-version-max=tls1.2');
  }
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

/**
 * Record every control the site exposes: the landing page, the form (single and
 * partnered, one child and two, since the partner field and the child tabs are
 * conditional), and the results panel.
 */
async function dumpForm(page) {
  const steps = [];
  const snap = async label => {
    steps.push({ label, heading: (await page.locator('h1,h2').first().innerText().catch(() => '')).replace(/\s+/g, ' ').trim(), ctrls: await controls(page) });
  };
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);
  await snap('Landing page');

  await clickText(page, M.start, { timeout: 20000 });
  await page.waitForSelector('input[value="single"]', { timeout: 20000 });
  await settle(page);
  await snap('Form — single, one child (defaults as pre-filled)');

  await page.locator('button[value="partnered"]').first().click();
  await page.waitForTimeout(400);
  await snap('Form — partnered (adds the partner participation field)');

  await clickText(page, M.addChild);
  await page.waitForTimeout(500);
  await snap('Form — two children (children are TABS; only the selected one renders)');

  // Reload before submitting. A child tab that has been added but never visited
  // leaves the form unsubmittable — "Calculate subsidy" simply does nothing —
  // which is the other reason fillAndRead selects and fills every tab in turn.
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await settle(page);
  await clickText(page, M.start, { timeout: 20000 });
  await page.waitForSelector('input[value="single"]', { timeout: 20000 });
  await settle(page);
  await clickText(page, M.submit);
  await page.waitForSelector('table', { timeout: 30000 });
  await settle(page);
  await snap('Results');
  const tables = await page.evaluate(() =>
    [...document.querySelectorAll('table')].map(t => t.innerText.replace(/\t/g, ' | ')));

  mkdirSync('reports', { recursive: true });
  const md = ['# StartingBlocks form dump', '',
    `Captured ${new Date().toISOString()} from ${URL}`, '',
    'The calculator is a landing page, then ONE form page, then a results page —',
    'not a multi-step wizard. Children are tabs: only the selected child\'s fields',
    'exist in the DOM. Activity hours and days are both asked PER FORTNIGHT, and the',
    'fee is asked as a DAILY rate.', '',
    ...steps.flatMap(s => [
      `## ${s.label}${s.heading ? ` — ${s.heading}` : ''}`, '',
      '| # | tag | type | value | button text | accessible name / question |',
      '|---:|---|---|---|---|---|',
      ...s.ctrls.map(c => `| ${c.i} | ${c.tag} | ${c.type} | ${String(c.value).replace(/\|/g, '\\|')} | ${(c.text || '').replace(/\|/g, '\\|')} | ${(c.name || '').replace(/\|/g, '\\|')} |`),
      '',
    ]),
    '## Results tables (rendered text)', '',
    ...tables.flatMap((t, i) => ['```', `table ${i}`, t, '```', '']),
  ].join('\n');
  writeFileSync('reports/dom-dump.md', md);
  console.log(`Wrote reports/dom-dump.md (${steps.length} snapshots).`);
}

/** The case list, generated once and reused so a resumed run compares the same inputs. */
function caseList() {
  const wrap = c => ({
    name: c.name,
    // The site always reports net of the 5% withholding; match its convention.
    input: { ...c.input, applyWithholding: SITE_APPLIES_WITHHOLDING },
  });
  if (!FRESH && existsSync(CASES_FILE)) {
    const saved = JSON.parse(readFileSync(CASES_FILE, 'utf8'));
    if (saved.length >= N - 40) {
      // Edge cases are deterministic and named, so ones added to edge-cases.mjs
      // since the list was saved should extend the run rather than be ignored.
      // The random gen-* sample is left exactly as it was, so a resumed run stays
      // comparable with the report it is extending.
      const have = new Set(saved.map(c => c.name));
      const added = edgeCases().filter(c => !have.has(c.name)).map(wrap);
      if (added.length) {
        console.log(`${added.length} new edge case(s) since this list was saved; adding them.`);
        saved.push(...added);
        writeFileSync(CASES_FILE, JSON.stringify(saved, null, 2));
      }
      return saved;
    }
    console.log(`${CASES_FILE} holds ${saved.length} cases, fewer than asked for; regenerating.`);
  }
  const cases = [...edgeCases(), ...generateCases(Math.max(0, N - 40))].map(wrap);
  mkdirSync('reports', { recursive: true });
  writeFileSync(CASES_FILE, JSON.stringify(cases, null, 2));
  return cases;
}

/** Compare one case's engine result against what the page displayed. */
function compareCase(c, sb, error) {
  const ours = calculateCcs(c.input);
  const cmp = (o, s) => (s == null ? null : round2(o - s));
  const row = {
    name: c.name, error: error ?? null,
    ourFnSub: ours.totals.perFortnight.subsidy, sbFnSub: sb?.perFortnight?.subsidy ?? null,
    ourWeekPaid: ours.totals.perWeek.paidSubsidy, sbWeekPaid: sb?.perWeek?.paidSubsidy ?? null,
    ourWeekOop: ours.totals.perWeek.outOfPocket, sbWeekOop: sb?.perWeek?.outOfPocket ?? null,
    ourFnOop: ours.totals.perFortnight.outOfPocket, sbFnOop: sb?.perFortnight?.outOfPocket ?? null,
    ourFnFees: ours.totals.perFortnight.fees, sbFnFees: sb?.perFortnight?.fees ?? null,
    ourPct: ours.standardPercent, sbShownPct: sb?.ccsPercent ?? null,
    // A child the page rendered as "-": the site declined to model it, so its
    // totals cover fewer children than the input. Reported, never counted as
    // a pass or a fail of the engine.
    unmodelled: sb ? sb.children.filter(ch => ch.feePerFortnight == null).map(ch => ch.n) : [],
  };
  row.dFnSub = cmp(row.ourFnSub, row.sbFnSub);
  row.dWeekPaid = cmp(row.ourWeekPaid, row.sbWeekPaid);
  row.dWeekOop = cmp(row.ourWeekOop, row.sbWeekOop);
  row.dFnOop = cmp(row.ourFnOop, row.sbFnOop);
  row.dFnFees = cmp(row.ourFnFees, row.sbFnFees);
  // Judged on displayed figures plus the fortnightly gross (a one-step sum that
  // reconciles exactly). Weekly gross is not displayed and is not judged.
  row.pass = !row.error && !row.unmodelled.length && [row.dFnSub, row.dWeekPaid, row.dWeekOop, row.dFnOop, row.dFnFees]
    .every(d => d === null || Math.abs(d) <= TOL);
  row.unmodelled = row.unmodelled.join(' ');
  return row;
}

function writeReports(cases, recorded) {
  const rows = cases.filter(c => recorded.has(c.name))
    .map(c => { const r = recorded.get(c.name); return compareCase(c, r.sb, r.error); });
  const golden = cases.filter(c => recorded.get(c.name)?.sb).map(c => {
    const sb = recorded.get(c.name).sb;
    // A child the page rendered as "-" (every figure blank) is one the site
    // declined to model — it does this for the second and later In Home Care
    // child. The family totals then cover fewer children than the input, so
    // the case cannot be a fair test of any engine. Record it, skip it, say why.
    const unread = sb.children.filter(ch => ch.feePerFortnight == null).map(ch => ch.n);
    // Weekly gross subsidy is dropped: the page displays neither gross figure,
    // and summing its two rounded weekly rows drifts a cent or two from the
    // fortnightly sum across several children. The fortnightly sum reconciles
    // exactly and is kept.
    const { subsidy: _weeklyGross, ...perWeek } = sb.perWeek;
    return {
      name: c.name, input: c.input,
      expected: {
        // Only figures the page displayed, plus the two documented sums
        // (fortnightly gross subsidy, family fees) explained on readResults.
        //
        // The displayed "Your CCS Rate" is NOT recorded as a child's ccsPercent:
        // the site prints it rounded to a whole percent with two decimal places
        // tacked on (84.70% shows as "85.00%"), so it is a display convention,
        // not a figure to compare against. It is kept in
        // reports/comparison.{md,csv} as `sbShownPct` instead.
        perWeek,
        perFortnight: sb.perFortnight,
      },
      tolerance: TOL,
      ...(unread.length ? {
        skip: true,
        skipReason: `StartingBlocks rendered "-" for child ${unread.join(', ')} (it does not model a second In Home Care child); its totals cover fewer children than the input`,
      } : {}),
    };
  });

  mkdirSync('reports', { recursive: true });
  writeFileSync('tests/golden-cases.json', JSON.stringify(golden, null, 2));
  const unmodelled = rows.filter(r => r.unmodelled);
  const fails = rows.filter(r => !r.pass && !r.unmodelled);
  const errs = rows.filter(r => r.error);
  const complete = rows.length === cases.length;
  const md = [
    `# StartingBlocks comparison — ${new Date().toISOString().slice(0, 10)}`, '',
    complete
      ? `${rows.length} cases: ${rows.length - fails.length - unmodelled.length} pass, ${fails.length} fail ` +
        `(${errs.length} of them could not be read at all), ${unmodelled.length} not modelled by the site ` +
        `(it renders "-" for a second In Home Care child; those are skipped in the golden file). Tolerance $${TOL}.`
      : `PARTIAL RUN: ${rows.length} of ${cases.length} cases read so far. ` +
        `${rows.length - fails.length} pass, ${fails.length} fail (${errs.length} unreadable). Tolerance $${TOL}.`,
    '',
    'Every case ran with `applyWithholding: true`, the convention the results panel uses.',
    'The subsidy column is the fortnightly GROSS (the page\'s "government pays" plus its "withholding").',
    '"SB %" is the rate the page printed, which it rounds to a whole percent, so it is',
    'not comparable to "Our %" and is shown for reference only.', '',
    '| Case | Our fn subsidy | SB fn subsidy | Δ | Our wk pay | SB wk pay | Δ | Our fn pay | SB fn pay | Δ | Our fn fees | SB fn fees | Δ | Our % | SB % | Result |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|',
    ...rows.map(r => `| ${r.name} | ${r.ourFnSub} | ${r.sbFnSub ?? '—'} | ${r.dFnSub ?? '—'} | ${r.ourWeekOop} | ${r.sbWeekOop ?? '—'} | ${r.dWeekOop ?? '—'} | ${r.ourFnOop} | ${r.sbFnOop ?? '—'} | ${r.dFnOop ?? '—'} | ${r.ourFnFees} | ${r.sbFnFees ?? '—'} | ${r.dFnFees ?? '—'} | ${r.ourPct} | ${r.sbShownPct ?? '—'} | ${r.error ? 'ERROR: ' + r.error : r.unmodelled ? `NOT MODELLED by site (child ${r.unmodelled} rendered "-")` : r.pass ? 'pass' : 'FAIL'} |`),
  ].join('\n');
  writeFileSync('reports/comparison.md', md);
  const csvCell = v => (typeof v === 'string' && /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  writeFileSync('reports/comparison.csv',
    [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(csvCell).join(','))].join('\n'));
  return { rows, fails, errs, unmodelled, complete };
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
  await page.close();

  if (FRESH) for (const f of [CASES_FILE, RAW_FILE]) if (existsSync(f)) writeFileSync(f, '');
  const cases = caseList();

  // Replay whatever a previous run already read off the site.
  const recorded = new Map();
  if (existsSync(RAW_FILE)) {
    for (const line of readFileSync(RAW_FILE, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const r = JSON.parse(line); recorded.set(r.name, r); } catch { /* truncated tail */ }
    }
  }
  const todo = cases.filter(c => !recorded.has(c.name));
  console.log(`${cases.length} cases; ${recorded.size} already read, ${todo.length} to go (${JOBS} in parallel).`);

  const started = Date.now();
  let next = 0, stopped = false;
  const worker = async () => {
    const p = await browser.newPage();
    try {
      while (next < todo.length) {
        if (BUDGET_MS && Date.now() - started > BUDGET_MS) { stopped = true; break; }
        const c = todo[next++];
        let sb = null, error = null;
        for (let attempt = 1; attempt <= RETRIES && !sb; attempt++) {
          try { sb = await fillAndRead(p, c.input); error = null; }
          catch (e) { error = String(e.message).split('\n')[0]; }
        }
        const rec = { name: c.name, sb, error };
        recorded.set(c.name, rec);
        appendFileSync(RAW_FILE, JSON.stringify(rec) + '\n');
        const row = compareCase(c, sb, error);
        process.stdout.write(`${row.pass ? 'PASS' : 'FAIL'} ${c.name}${error ? ' — ' + error : ''}\n`);
      }
    } finally { await p.close().catch(() => {}); }
  };
  await Promise.all(Array.from({ length: Math.max(1, JOBS) }, worker));
  await browser.close();

  const { rows, fails, unmodelled, complete } = writeReports(cases, recorded);
  if (!complete) {
    const left = cases.length - rows.length;
    console.log(`\n${rows.length - fails.length}/${rows.length} pass so far. ` +
      `${left} case(s) still to read${stopped ? ' (time budget reached)' : ''} — re-run the same command to resume.`);
    process.exit(3);
  }
  console.log(`\n${rows.length - fails.length - unmodelled.length} pass, ${fails.length} fail, ${unmodelled.length} not modelled by the site, of ${rows.length}. Report: reports/comparison.md`);
  process.exit(fails.length ? 1 : 0);
}
main();
