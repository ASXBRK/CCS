# Project review — engine logic, figures and harness

Reviewed 2026-09-11 against three independent references: the live StartingBlocks
calculator (508 cases, `reports/comparison.md`), the Macquarie Big Black Book
2026/27 CCS tables (`au-fy-figures`), and Services Australia / Family Assistance
Guide guidance as of July 2026 (government sites refuse automated fetches, so the
official wording below is as reported by search summaries of those pages, not
quoted from a page this review could open).

Nothing in this review changes code. Every recommendation is stated as a diff so it
can be applied deliberately.

> **Applied.** E1, E2, E3 and T1 below were applied the same day, mirrored into
> `ccs-calculator.html`, with the tests in §6 added. Applying them exposed one
> more convention, in two parts: StartingBlocks builds its **weekly family total
> by halving and rounding each child's fortnight and summing**, where the engine
> halved the family fortnight — a 1–2 cent drift on some three-child families
> (`gen-454`) — and its **weekly withholding is 5% of the week's gross**, worked
> out afresh rather than halved from the fortnight (11 cases, 2 cents each). The
> engine now does both the site's way. The golden harness also now marks the
> 21 cases the site refuses to model as `skip` with the reason recorded, and no
> longer records a derived weekly gross the page never displays. Result:
> `npm run golden → 487 passed | 21 skipped`, `npm test` green, typecheck clean.
> U1 and A1 remain open.

## 1. Verdict

The engine's **figures are all correct**. Every threshold, taper, hourly cap, the
72/100-hour bands, the strict >48-hour test and the 5% withholding rate match all
three references. `src/ccsRates.ts` needs no change.

The engine's **logic has two rule errors and one arithmetic convention** that
differ from both the live calculator and the published rules. All three are in
`src/ccsEngine.ts` (and mirrored in `ccs-calculator.html`). The earlier comparison
flagged two of them as "check against the legislation before fixing"; that check is
now done and the site is right on both.

| # | What | Where | Severity |
|---|---|---|---|
| E1 | Higher rate stops one dollar early ($370,726 should still get it) | `higherPercent` | Low — one income value, but $100–$300/fn on it |
| E2 | In Home Care children are given the higher rate; they should always be standard | `calculateCcs` | **Medium** — $11–$300/fn, 3% of random cases |
| E3 | Hourly subsidy is not rounded to cents before × hours | `calculateCcs` | Low — ≤ $0.74/fn, but it is 74% of all golden failures |
| T1 | Golden test's tolerance check is float-fragile | `tests/golden.test.ts` | Medium — spurious failures on exact-1-cent differences |
| U1 | Duplicate child ids after remove-then-add | `CcsCalculator.tsx` | Low — UI only |
| A1 | Income provenance mis-tagged as `lifeEvent` by child-only events | `strategyBuilderAdapter.ts` | Low — label only |
| D1 | HANDOFF/rates comments state E1's wrong boundary as the rule | docs | Low |

Section 6 has the recommended diffs; section 7 the effect of each on the golden
suite.

## 2. Figures verified

| Parameter | Engine | BBB 2026/27 | Live site | Match |
|---|---|---|---|---|
| Standard: 90% to $88,520, −1pp per $5,000, nil at $538,520 | ✓ | same | same | ✓ |
| Higher: 95% to $146,437; −1pp per $3,000 to 80% at $191,437; 80% to $270,726; −1pp per $3,000 to 50% at $360,726 | ✓ | same | same | ✓ |
| Higher rate ends | **at $370,726** | "$360,727 – $370,726 → 50%; $370,727+ → nil" | keeps 50% at $370,726, nil at $370,727 | ✗ E1 |
| Caps: CBDC/OSHC $15.19 / $13.30 (school age); FDC $14.08; IHC $41.31 | ✓ | same | solved back from displayed subsidy, exact | ✓ |
| Hours: 72 baseline; 100 if lower adult > 48 hrs/fn | ✓ | "48+ → 100" (loose wording) | 48 → 72, 49 → 100 | ✓ |
| School-age cap from age 6 | ✓ | — | 5 → $15.19, 6 → $13.30 | ✓ |
| Withholding 5% | ✓ | — | 5%, always applied | ✓ |
| CCS % rounded to 2 dp, nearest | ✓ | — | confirmed by two probes at the IHC cap | ✓ |
| Higher-rate children "aged 5 or under" | `ageYears <= 5` ✓ | "under 5" (loose) | age 5 gets it | ✓ |

The BBB's "48+" and "under 5" are its own shorthand; the legislation and the live
tool both use "more than 48" and "5 or under", which is what the engine does.

## 3. Engine logic — line by line

`standardPercent` — correct, including both end points.

`higherPercent` — the taper arithmetic is correct at every internal boundary (all
continuous, so `<` vs `<=` there cannot matter). The revert test is wrong:

```ts
if (income >= h.revertThreshold) return null;   // E1: should be >
```

Services Australia (July 2026): the higher rate applies to families "with income
below $370,727"; the BBB table ends the 50% band at $370,726 inclusive; the live
site keeps 50% at exactly $370,726 and drops it at $370,727. Three sources, one
answer. The engine test at `tests/engine.test.ts:34` and the docs encode the wrong
reading and will need to move with the fix.

`entitledHours` — correct. Uses the lower adult when partnered, `> 48`, exemption
→ 100.

`calculateCcs`, higher-rate attribution — correct except for In Home Care:

```ts
const isHigher = higherApplies && c.ageYears <= 5 && c.id !== standardRateChildId;
// E2: needs "&& c.careType !== 'IHC'"
```

Services Australia: the higher rate "does not apply to IHC sessions because IHC is
subsidised per family, not per child. IHC will continue to be paid the standard
CCS rate" — but "a child aged 5 or under in IHC can still count when working out
whether younger children in other approved care types attract the higher rate".
That is exactly what the live site does, and it was the reading that explained
every case in the comparison (the alternative, excluding IHC children from the
count altogether, left 19 cases unexplained). So: IHC children keep counting toward
the two-children test and toward "eldest under six"; only their own rate is forced
to standard.

Tie-breaking for the standard-rate child (two under-sixes the same whole age):
`sort` is stable, so the first-listed wins. The site does the same — the two
tied-age golden cases (`gen-234`, `gen-334`) reconcile on that reading. Fine, but
undocumented; worth a comment.

`calculateCcs`, arithmetic — the site (and, per the Family Assistance Guide's
"hourly rate of CCS" construction, Services Australia) computes a per-hour subsidy
in cents and multiplies it by hours:

```ts
const hourlySubsidy = (pct / 100) * cappedFee;          // engine keeps full precision
const subsidyFn = hourlySubsidy * subsidisedHours;      // E3: site uses round2(hourlySubsidy)
```

The engine already *reports* `hourlySubsidy` rounded, so its own output is
internally inconsistent by up to half a cent per hour: the displayed hourly figure
times the displayed hours does not equal the displayed fortnightly subsidy. The fix
is to round once and use the rounded value. Two details if matching the site to the
cent is the goal: multiply by the unrounded capped fee (`dailyFee / hoursPerDay`
often repeats), and compute the rate as a 4-decimal fraction, not `percent / 100`
(`47.70% × $15.00` must give `7.15`, `51.70% × $15.00` must give `7.76`; both are
half-cent ties that IEEE-754 resolves differently — the site does both). Withholding
is likewise rounded to cents on the site (`withheld = round2(subsidy × 5%)`).

School-age default `ageYears >= 6` — a proxy; the legislation keys the lower cap to
attending school, not age. The site has no school question at all, so the engine
is strictly more capable here. Keep the override.

IHC cap "per family" — engine applies it per child and warns. The site's answer to a
second IHC child is to render `-` for it, so this cannot be settled from the
comparison. Genuinely open; the warning is the right behaviour.

`perYear = fortnight × 26` — fine as an estimate.

## 4. Tests

`tests/engine.test.ts` — sound apart from encoding E1 (`higherPercent(370_726)`
expected null; the test named "reverts to standard at $370,726+"). Line 63 pins
`subsidyPerFortnight` to the unrounded product (`1180.26` where the site would show
`1180.00`); that expectation moves with E3. There is no test for an IHC child in a
higher-rate family (E2) and none for two under-sixes of the same age.

`tests/golden.test.ts` — **float-fragile** (T1):

```ts
expect(Math.abs(res.totals[period][k] - exp[k]!)).toBeLessThanOrEqual(tol);
```

`Math.abs(65.26 - 65.25)` is `0.010000000000005` and fails a `0.01` tolerance;
`Math.abs(312.31 - 312.30)` is `0.00999999999999` and passes. Of the 3,048 expected
figures in the golden file, 570 would spuriously fail on a genuine 1-cent
difference. Compare in integer cents (`Math.round(x*100)`) or add an epsilon. The
comparison script is not affected — it rounds the difference before testing it.

`tests/golden-cases.json` — one caveat on my own derivation. `perWeek.subsidy` is
the sum of two *displayed weekly* figures (government pays + withholding), each
already rounded, so it can sit a cent from `round(perFortnight.subsidy / 2)`. It is
faithful to what the page showed; just don't treat the weekly gross as more precise
than a cent.

`tests/adapter.test.ts` — sound.

## 5. Adapter, UI, HTML copy, docs

`strategyBuilderAdapter.ts`
- A1: `familyIncome.source` is `'lifeEvent'` whenever *anything* was touched
  (`touched.size`), so a `changeCareDays` event relabels income as life-event
  sourced. Should test for an `adult:` key.
- Partnered household with one adult listed → partner participation silently 0 →
  72 hours. Defensible, but worth a warning or a provenance note.
- `DEFAULTS.applyWithholding: false`. StartingBlocks shows every figure net of the
  5% and has no switch; HANDOFF §3 says to match the government calculator's
  convention once known. It is now known. Consider `true`, or at least default the
  UI checkbox on.
- `DEFAULTS.daysPerFortnight: 6` vs the site's 7. `hoursPerDay` already matches the
  site's national averages for every care type it publishes one for. Fee defaults
  are deliberately firm placeholders (HANDOFF §3); the site's national averages
  ($120 / $110 / $32 a day for CBDC / FDC / OSHC) are the right fallback.

`CcsCalculator.tsx`
- U1: `newChild(input.children.length + 1)` — remove a middle child, add one, and
  two children share an id. `updateChild` then patches both and `result.children
  .find` returns the wrong one. Use a counter or `crypto.randomUUID()`.
- The "Attends school" checkbox is the one input the site lacks; keep it.

`ccs-calculator.html`
- The inline engine is a faithful copy of the TS engine, bugs included (same `>=`
  at line 144, same IHC omission at 167, same unrounded product at 176). Any engine
  fix must be mirrored here, per `CLAUDE.md`.
- Its comparison panel checks `res.standardPercent` against the StartingBlocks
  "Your CCS Rate". The site prints that rate rounded to a whole percent (84.70%
  shows as "85.00%"), so that row will read as a mismatch on almost every income.
  Either drop the row or compare `Math.round`.

Docs
- `docs/HANDOFF.md` §2: "at $370,726 or more every child reverts to the standard
  rate" — wrong by a dollar (E1). Same section should say In Home Care never takes
  the higher rate (E2). §9 "known simplifications" should list E3 if it is not
  fixed.
- `src/ccsRates.ts:33` comment "at/above → higher rate no longer applies" — same.
- `docs/COMPARISON-STATUS.md` §7 and §8 say "check against the legislation before
  changing anything". Done; the site is right on both. Those two sections can now
  say so.

## 6. Recommended diffs

**E1 + E2 + E3 — `src/ccsEngine.ts`** (mirror in `ccs-calculator.html`):

```diff
 export function higherPercent(income: number, r: CcsRates = getRates()): number | null {
   const h = r.higher;
-  if (income >= h.revertThreshold) return null;
+  if (income > h.revertThreshold) return null;   // $370,726 still gets the higher rate
```

```diff
-    const isHigher = higherApplies && c.ageYears <= 5 && c.id !== standardRateChildId;
+    // In Home Care is subsidised per family and is always paid the standard rate,
+    // but an IHC child still counts toward the two-children test and toward
+    // which child is the eldest under six.
+    const isHigher = higherApplies && c.ageYears <= 5 && c.id !== standardRateChildId
+                  && c.careType !== 'IHC';
```

```diff
-    const hourlySubsidy = (pct / 100) * cappedFee;
+    // Services Australia works in a per-hour subsidy expressed in cents.
+    // Rate as a 4-dp fraction, not pct/100, so half-cent ties resolve as theirs do.
+    const hourlySubsidy = round2(Number((pct / 100).toFixed(4)) * cappedFee);
     ...
-    const withheld = input.applyWithholding ? subsidyFn * r.withholdingRate : 0;
+    const withheld = input.applyWithholding ? round2(subsidyFn * r.withholdingRate) : 0;
```

and in `ccsRates.ts` the comment on `revertThreshold` becomes "last income that
still gets the higher rate".

**T1 — `tests/golden.test.ts`**:

```diff
-if (exp[k] != null) expect(Math.abs(res.totals[period][k] - exp[k]!), `${period}.${k}`).toBeLessThanOrEqual(tol);
+const cents = (n: number) => Math.round(n * 100);
+if (exp[k] != null) expect(Math.abs(cents(res.totals[period][k]) - cents(exp[k]!)), `${period}.${k}`).toBeLessThanOrEqual(cents(tol));
```

**Tests to add** — `higherPercent(370_726) === 50`, `higherPercent(370_727) === null`;
an IHC second child at $150,000 stays on 77.70% while a CBDC sibling gets 93.81%;
a 7-year-old plus a 1-year-old in IHC both standard; two 4-year-olds — first-listed
is standard.

## 7. What each fix does to the golden suite

Computed outside the engine, on the committed 508 cases, with the tolerance
evaluated in exact cents (T1 applied):

| Engine state | Golden cases passing |
|---|---:|
| As committed | 87 / 508 |
| + E1 + E2 (rule fixes only) | 88 / 508 |
| + E3 (cent rounding only) | 462 / 508 |
| + E1 + E2 + E3 | **477 / 508** |

Of the 31 that remain: 21 are the multi-IHC families the site refuses to model
(no engine can pass them; they should be `skip: true` with that reason, or dropped
from the generator), and 10 are one-cent weekly-column disagreements — the site's
own half-up rounding of an odd-cent fortnight, landing differently on a float tie.
Without T1 the same engine scores 426 / 508, the difference being nothing but
`0.010000000000005 > 0.01`.

So the honest picture is: the engine is a correct implementation of the published
rules except at one dollar of income, one care type's rate, and one rounding step,
and fixing those three lines plus the test's comparison takes the golden suite from
17% to 94% — with every remaining case accounted for.

## 8. Sources

- Live calculator: `reports/comparison.md` (508 cases) and the ad-hoc probes recorded in `docs/COMPARISON-STATUS.md` §5 and §8.
- Macquarie Big Black Book 2026/27 CCS tables, via the `au-fy-figures` reference.
- Services Australia, *Your number of children in care can affect your higher Child Care Subsidy* and *Examples to help you understand your Child Care Subsidy* (July 2026) — IHC paid at the standard rate but its child still counts; higher rate for income "below $370,727".
- Family Assistance Guide 3.5.4 *Calculating CCS entitlement* and 1.1.I.70 *Income thresholds (CCS)*.
- CCS Checker AU, *Second Child Higher CCS Rate Explained* (2026-27 confirmed figures).
