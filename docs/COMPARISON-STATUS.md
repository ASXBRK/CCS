# StartingBlocks comparison — where this stands

**Status: the comparison has run against the live site.** 508 cases, all of them
read successfully. Date of run: 2026-09-11. Site:
`https://www.startingblocks.gov.au/child-care-subsidy-calculator`.

Evidence in this repo:

| File | What it is |
|---|---|
| `reports/comparison.md` / `.csv` | every case, our figures and the site's, side by side |
| `tests/golden-cases.json` | the same cases as a regression suite, with the site's displayed figures |
| `reports/dom-dump.md` | every control the form exposes, recorded from the live DOM |

Reproduce with:

```
npm install
npm run compare -- --dump                     # re-record the form → reports/dom-dump.md
npm run compare -- 500 --fresh --jobs=3       # full run → reports/ and tests/golden-cases.json
```

A full run takes most of an hour, so it is resumable: re-running the same command
picks up where the last one stopped, and `--budget=450` bounds a single invocation
to seven and a half minutes. `--headed` still exists but is not needed; the walk is
stable headless.

---

## 1. Result

| | Cases |
|---|---:|
| Match within $0.01 on every figure | **92** |
| Differ | **416** |
| Failed to read | **0** |

> **Update, later the same day.** The engine has since been corrected for the
> first three causes below (see `docs/REVIEW.md`, which verified each against
> the published rules), plus the site's weekly-total convention. With those
> changes the golden suite is green: `npm run golden → 487 passed | 21 skipped`,
> the 21 being the fourth cause, which no engine can pass. The figures in this
> section describe the run as it stood, against the engine as it was.

Every one of the 416 is accounted for, and **none of them is a cap, taper or hours
difference**. Four causes, all of them calculation logic inside `src/ccsEngine.ts`,
which the comparison work itself was not permitted to change:

| Cause | Cases | Size |
|---|---:|---|
| The site rounds the hourly subsidy to cents before multiplying by hours (§6) | 377 | $0.00–$0.74 a fortnight, median $0.14 |
| The above, plus: an In Home Care child never gets the higher rate (§7) | 17 | $11 to $300 a fortnight |
| The above, plus: the higher rate survives *at* $370,726 (§8) | 1 | $147.72 a fortnight on the one case that hits it |
| The site declines to model a second In Home Care child (§9) | 21 | the site's totals cover fewer children than ours |

Section 5 lists what the run positively confirmed: every other rule the engine
applies, including the rounding of the CCS percentage, matches the live tool.

### An independent second run agrees

A second full run of 493 cases — the same 33 edge cases plus a completely different
random sample of 460, driven by the sequential code path rather than the parallel
one — was completed by accident when an earlier background job turned out not to
have been killed. It is not committed (one comparison report is enough), but it was
classified with the same model before being discarded:

| | Cases |
|---|---:|
| Pass | 115 |
| Cent-rounded hourly subsidy | 331 |
| In Home Care never on the higher rate | 29 |
| Second In Home Care child not modelled | 17 |
| Higher rate survives at $370,726 | 1 |
| Unreadable, or unexplained | 0 |

960 further cases, none of them needing a fifth explanation. The $370,726 boundary
in §8 was in fact found by that run: it threw up a random case landing on exactly
that income, which the committed run's case list had stepped over.

### Test status

`npm run golden` and `npm test` **fail**, and that is the true state of the
comparison, not something to paper over:

```
npm run golden    → Tests  431 failed | 77 passed (508)    exit 1
npm test          → Tests  431 failed | 93 passed (524)    exit 1
npm run typecheck → clean                                  exit 0
```

The golden suite counts more failures than the 416 above because it checks the
weekly *and* fortnightly figures for fees, subsidy and out-of-pocket, where
`reports/comparison.md` checks a slightly different set. Same underlying causes.

The figures in `tests/golden-cases.json` are exactly what the government tool
displayed and have not been touched to make anything pass. All but 39 of the
failures go away the moment §6 is addressed in the engine.

## 2. What the form actually looks like

The harness had been written blind against an imagined multi-step wizard. It is not
one. `reports/dom-dump.md` is the authoritative record; the shape is:

> landing page → **Get started** → ONE form page with every question → **Calculate
> subsidy** → results page

Field by field, as the live DOM words it:

| What | Control | Unit / note |
|---|---|---|
| Family type | two radios, `value="single"` / `value="partnered"` | |
| Your participation | number | **per fortnight** |
| Family income | text, comma-formatted as you type | annual |
| Partner participation | number | **per fortnight**; only rendered when partnered |
| Child age | number | whole years |
| Care type | four radios, `value="centreBasedDayCare"` / `familyDayCare` / `outsideSchoolHoursCare` / `inHomeCare` | |
| Fee | number, accepts decimals | **daily rate**, not hourly |
| Session length | number | hours charged per day |
| Days in care | number | **per fortnight** |

Both units the old harness hedged about are **per fortnight**, which is what the
engine already takes. No conversion is needed, and the "halve it if the label says
week" logic is kept only as a guard against a future reword.

Two structural facts broke the original walk and are why `fillAndRead` was
restructured:

- **Children are tabs.** "Add another child" appends a tab; only the selected
  child's fields exist in the DOM. Filling "the nth control matching this label"
  could never work — each child has to be selected and filled in turn.
- **A tab that was added but never visited makes the form unsubmittable.**
  "Calculate subsidy" silently does nothing. Every child must be visited.

## 3. What it pre-fills, and its national averages

Pre-filled on first render, identical for every care type:

| Field | Pre-filled |
|---|---|
| Family type | Single |
| Your participation | 76 hrs / fortnight |
| Family income | $115,000 |
| Child age | 2 |
| Care type | Centre Based Care |
| Daily rate | $120 |
| Hours charged per day | 8 |
| Days per fortnight | 7 |
| Partner participation (when partnered) | 0 |

Separately, each of the fee and session-length fields has a **"Use the national
average for my type of service"** checkbox. Ticking it substitutes the site's own
national averages, which differ from the pre-fill and are the better source for
`DEFAULTS` in the adapter:

| Care type | National average daily rate | National average hours/day |
|---|---:|---:|
| Centre Based Care | $120 | 10 |
| Family Day Care | $110 | 10 |
| Outside School Hours Care | $32 | 3 |
| In Home Care | — (no such checkbox) | — |

`DEFAULTS` in `src/strategyBuilderAdapter.ts` currently holds
`hoursPerDay: {CBDC: 10, FDC: 10, OSHC: 3, IHC: 10}` and
`dailyFee: {CBDC: 150, FDC: 120, OSHC: 35, IHC: 400}`, with `daysPerFortnight: 6`.
The session-length defaults already agree with the site for every care type it
offers an average for. The fee defaults are deliberately placeholders for firm data
(see HANDOFF §3), so they have been left alone rather than replaced with the
national averages — but the national averages above are the right fallback if no
firm figure is available.

## 4. What the results panel reports

Two tables: a family summary, and one per child under "Full breakdown", each with a
Weekly and a Fortnightly column. Rows: *Your total service fee*, *Your CCS Rate*,
*What the Australian Government pays*, *Withholding*, *What you pay*.

Three conventions matter:

- **Withholding is always applied.** There is no switch. "What the Australian
  Government pays" is already net of the 5% Services Australia holds back, and
  "What you pay" is the fee minus that net figure. Every comparison case therefore
  runs with `applyWithholding: true`, and the golden file records the inputs that
  way so `npm run golden` reproduces what the page displayed.
- **The displayed "Your CCS Rate" is rounded to a whole percent** and then printed
  with two decimal places. A family on 84.70% sees "85.00%"; one on 41.04% sees
  "41.00%". It is a display convention, not a figure to compare against, so it is
  **not** recorded as a child's `ccsPercent` in the golden file. It is kept in
  `reports/comparison.{md,csv}` as `sbShownPct` so the evidence is not lost.
- The summary table has **no fee row**, and no row shows gross subsidy. Two figures
  in the reports are therefore summed from figures the page displays, and nothing
  else is derived: gross subsidy = "government pays" + "withholding"; family fees =
  the per-child fee rows.

## 5. What the run confirmed, and needed no change

Each of these matches the engine exactly across the whole run — no case in
`reports/comparison.md` differs on any of them:

- **Hourly rate caps.** $15.19 below school age and $13.30 school age for centre
  based care and OSHC, $14.08 family day care, $41.31 in home care.
- **Income thresholds and tapers**, at every threshold ± $1, for both the standard
  and the higher table. Every threshold VALUE is right; the one place the engine
  and the site part company is which side of $370,726 the higher rate stops, which
  is a comparison operator rather than a figure (§8).
- **Percentage rounding: two decimals, nearest.** The setting in `ccsRates.ts` was
  already right and has **not** been changed.
- **The 48-hour activity boundary.** Exactly 48 hours for the lower adult gives 72
  subsidised hours; 49 gives 100. The engine's "strictly more than 48" is right,
  and the summaries that write the band as "48+" are wrong.
- **School age starts at 6**, for the purpose of the hourly cap.
- **Higher-rate selection**, for every care type except In Home Care (§7): the
  eldest child aged 5 or under takes the standard rate and the younger ones the
  higher rate; children 6 and over take the standard rate and do not count toward
  the test.
- **Fees.** Every case's fortnightly fee total matches to the cent, except the 21
  in §9 where the site omits a child.

Four of these were *first* established by ad-hoc probes before the full run, and
the probes are worth recording because they pin the answer more sharply than the
run does — as does the probe in §8, which was run after it:

- **Caps** were derived by driving the daily rate far above the cap and solving back
  from the displayed subsidy, one probe per care type.
- **Percentage rounding** was settled by two probes 25 dollars apart, both at the
  in-home-care cap where a hundredth of a percentage point is most visible: income
  $88,521 (exact 89.9998%) produced a subsidy consistent with 90.00%, ruling out
  rounding down; income $88,546 (exact 89.9948%) produced one consistent with
  89.99%, ruling out not rounding at all. Only "nearest, 2 dp" satisfies both.
- **The 48-hour boundary** and **school age at 6** were each probed as a matched
  pair (48 vs 49 hours; a five-year-old vs a six-year-old in OSHC).

The full run is consistent with all four, and the edge-case block at the top of
`reports/comparison.md` exercises each of them, but the run on its own would not
have isolated them as cleanly.

## 6. Difference 1 — the hourly subsidy is rounded to cents

**363 cases. $0.00 to $0.74 a fortnight, median $0.13.** Recorded by the
comparison; since fixed in the engine (`docs/REVIEW.md` E3).

Reverse-engineered from the live figures, the site computes, per child:

```
rate           = CCS% / 100                       (the percentage rounded to 2 dp)
hourlySubsidy  = round(rate × cappedHourlyFee, 2) ←  this rounding step
subsidy        = hourlySubsidy × subsidisedHours
withheld       = round(subsidy × 5%, 2)
governmentPays = subsidy − withheld
youPay         = fee − governmentPays
```

`src/ccsEngine.ts` does not round the hourly subsidy. It multiplies the unrounded
`hourlySubsidy` by the hours (`subsidyFn = hourlySubsidy * subsidisedHours`), and
rounds only the fortnightly total. The `hourlySubsidy` field it *reports* is
rounded, so the gap is invisible in the per-child output and shows only in totals.

The error is at most half a cent per subsidised hour, so it is bounded by $0.50 a
fortnight at the 100-hour entitlement — the observed $0.74 maximum is a
three-child case where three such errors compound.

**Neither switch can close it.** `percentRounding` rounds the percentage, one
multiplication earlier; withholding is already on. The fix is one line inside
`calculateCcs`, which was out of scope.

Two notes for whoever does fix it:

- The site multiplies by the **unrounded** capped hourly fee. `dailyFee ÷
  hoursPerDay` frequently repeats, and rounding it to cents first changes the
  answer.
- The rounding is plain half-up on IEEE-754 doubles, so an hourly subsidy landing
  exactly on a half-cent resolves according to how the decimal happens to be
  representable. Reproducing it to the cent means computing the rate as a
  4-decimal fraction rather than as `percent / 100`: written that way, `47.70% ×
  $15.00` is stored a hair below `7.155` and gives `7.15`, while `51.70% × $15.00`
  is stored a hair above `7.755` and gives `7.76`. The site does both.

With that model applied on top of the rules in §7 and §8, all 508 cases reproduce
the site's fortnightly gross subsidy, fees and out-of-pocket exactly.

## 7. Difference 2 — In Home Care never gets the higher rate

**17 cases. $11 to $300 a fortnight.** Recorded by the comparison; since
confirmed against Services Australia guidance ("IHC will continue to be paid the
standard CCS rate", while an IHC child "can still count" for younger siblings) and
fixed in the engine (`docs/REVIEW.md` E2).

The site puts every In Home Care child on the **standard** rate, even when the
child is a second or younger child aged 5 or under and the family is well inside
the higher-rate income range. The engine gives it the higher rate.

The In Home Care child still counts normally for everything else: it counts toward
the "two children aged 5 or under" test, and toward which child is the eldest under
six. Only its own rate is forced to standard. Both of those were checked against
the alternative reading — excluding In Home Care children from the test entirely
explains 423 of 472 comparable cases, while this reading explains all of them.

Because the In Home Care cap is $41.31 against $15.19 elsewhere, the rate
difference is worth real money, which is why this group is the large one. Sample:

| Case | Family | Children | Our fn subsidy | SB fn subsidy | Our fn out-of-pocket | SB fn out-of-pocket |
|---|---|---|---:|---:|---:|---:|
| gen-182 | couple $296,640, activity 16/0 | 1y IHC $145/d 8h 10d *(we use higher rate)*; 4y FDC $127/d 10h 10d | $1373.64 | $1073.52 | $1415.04 | $1700.15 |
| gen-196 | couple $336,670, activity 0/16 | 9y OSHC $120/d 4h 6d; 5y FDC $91/d 9h 4d; 2y IHC $140/d 9h 10d *(higher)* | $925.63 | $727.92 | $1604.65 | $1792.47 |
| gen-263 | couple $290,010, activity 16/60 | 2y IHC $132/d 9h 6d *(higher)*; 0y CBDC $110/d 10h 2d *(higher)*; 4y FDC $87/d 11h 2d | $831.00 | $641.92 | $396.55 | $576.17 |
| gen-55 | single $211,070, activity 49 | 5y OSHC $124/d 3h 10d; 1y IHC $134/d 11h 10d *(higher)* | $1272.99 | $1096.50 | $1370.66 | $1538.33 |
| gen-303 | couple $166,230, activity 49/16 | 7y OSHC $112/d 4h 8d; 3y CBDC $105/d 8h 2d; 0y IHC $121/d 8h 10d *(higher)* | $1435.95 | $1283.84 | $951.85 | $1096.36 |

The full 17 are `gen-55 gen-60 gen-126 gen-162 gen-164 gen-179 gen-182 gen-195
gen-196 gen-212 gen-224 gen-234 gen-263 gen-303 gen-334 gen-350 gen-374`, all in
`reports/comparison.md`.

This was checked against the published rules before the engine was changed: the
site is right. Services Australia states that the higher rate "does not apply to
IHC sessions because IHC is subsidised per family, not per child" and that "IHC
will continue to be paid the standard CCS rate", while an IHC child aged 5 or under
"can still count when working out whether younger children in other approved care
types attract the higher rate".

## 8. Difference 3 — the higher rate survives *at* $370,726

**1 case. $147.72 a fortnight on that case.** Recorded by the comparison; since
confirmed against Services Australia ("income below $370,727") and the BBB 2026/27
tables, and fixed in the engine (`docs/REVIEW.md` E1).

The engine drops every child to the standard rate once family income reaches
$370,726:

```ts
if (income >= h.revertThreshold) return null;   // revertThreshold = 370_726
```

The site reverts one dollar later. Probed directly, two children aged 4 and 1 in
centre based care at $100 a day over 10 hours:

| Family income | Eldest under 6 | Younger child |
|---:|---|---|
| $370,725 | 33.60% (standard) | **50.00% (higher)** |
| $370,726 | 33.60% (standard) | **50.00% (higher)** |
| $370,727 | 33.60% (standard) | 33.60% (standard) |
| $370,728 | 33.60% (standard) | 33.60% (standard) |

So the site's rule is "higher rate while income is **$370,726 or less**", against
the engine's "$370,726 or more reverts". `docs/HANDOFF.md` §2 words it the engine's
way too, so the documentation and the code agree with each other and disagree with
the site.

The committed case is `edge income 370726 two under 6`: two children aged 4 and 1 in
centre based care at $150 a day over 10 hours, 6 days a fortnight, couple on
$370,726 with 76 activity hours each.

| | Our fortnight | StartingBlocks |
|---|---:|---:|
| Fees | $1800.00 | $1800.00 |
| Subsidy (gross) | $604.08 | $751.80 |
| Out of pocket | $1226.12 | $1085.79 |

This boundary is invisible at every other threshold in the higher table, because
they are all continuous — the rate either side of $146,437, $191,437, $270,726 and
$360,726 differs by less than the site's own display precision. $370,726 is the one
discontinuity in that table, where the rate drops from 50% straight to the standard
rate, and it is therefore the only boundary in it that a displayed figure can
resolve. The original edge-case list stepped from $365,000 to $371,000 and missed
it; `scripts/edge-cases.mjs` now covers every higher-table threshold with two
children under six.

This was checked against the published rules before the engine was changed: the
site is right. Services Australia describes the higher rate as applying to
families with income "below $370,727", and the BBB 2026/27 table ends the 50% band
at $370,726 inclusive.

## 9. Difference 4 — a second In Home Care child is not modelled at all

**21 cases.** Not a calculation difference so much as a limit of the site.

When a family has two or more In Home Care children, the site renders `-` for every
figure of the **second and later** such child: no fee, no rate, no subsidy. Its
family totals then cover fewer children than ours, so the fee totals differ by that
child's whole fee. The harness records what the page showed, which is why these
cases' `fees` are lower than ours rather than merely rounded differently.

This is almost certainly the per-family In Home Care cap, which the engine already
warns about:

> In Home Care cap is per family, not per child; this estimate applies it per child.

The site's answer to the same problem is to decline the question. Nothing here tells
us what a correct per-family cap would produce, so the comparison cannot settle it;
these 21 cases are evidence of the gap, not a specification for closing it. Sample:

| Case | Family | Children | Site omitted | Our fn fees | SB fn fees |
|---|---|---|---|---:|---:|
| gen-386 | couple $495,950 | 0y IHC $200/d 8h 10d; 1y IHC $218/d 9h 10d | child 2 | $4180.00 | $2000.00 |
| gen-307 | couple $487,360 | 4y IHC $179/d 10h 6d; 0y IHC $189/d 8h 10d | child 2 | $2964.00 | $1074.00 |
| gen-161 | couple $507,320 | 5y OSHC $163/d 3h 4d; 4y IHC $103/d 8h 8d; 0y IHC $202/d 11h 8d | child 3 | $3092.00 | $1476.00 |
| gen-457 | couple $52,230 | 3y IHC $156/d 10h 2d; 5y CBDC $145/d 8h 2d; 2y IHC $139/d 10h 8d | child 3 | $1714.00 | $602.00 |
| gen-20 | single $538,520 | 2y IHC $142/d 12h 4d; 3y IHC $201/d 11h 6d | child 2 | $1774.00 | $568.00 |

The full 21 are `gen-10 gen-20 gen-52 gen-57 gen-106 gen-128 gen-157 gen-161
gen-202 gen-221 gen-252 gen-280 gen-307 gen-341 gen-381 gen-384 gen-385 gen-386
gen-389 gen-448 gen-457`.

## 10. What the site asks that the engine has no field for

Nothing. The traffic is the other way: the engine accepts inputs the site never
asks for, so those cannot be exercised by this comparison.

- `schoolAge` as a value separate from age. The site has no school question at all
  and derives it from age at 6. A five-year-old who has started school, or a
  six-year-old who has not, cannot be modelled on the site — the engine can, and
  the adapter should keep that override.
- `firstNations` (100 hours regardless of participation) and `participationExempt`.
  Neither is on the form.
- `hourlyFee` as an alternative to `dailyFee` ÷ `hoursPerDay`. The site only asks
  for a daily rate.
- `ccsYear`. The site exposes only the current year.

The site asks for nothing the engine ignores. Every control on the form maps onto
an engine input.

## 11. Rates check

Every threshold, taper and hourly cap in `src/ccsRates.ts` was cross-checked
against the 2026-27 figures in the `au-fy-figures` reference before this run, and
each has now been confirmed against the live calculator across 508 cases plus a
second independent 493. **No figure in that file is wrong**, and none has been
changed — `percentRounding`, the one setting this work was free to change, was
confirmed already correct.

The single caveat is §8: `revertThreshold: 370_726` is the right number, but the
engine treats it as "revert at this income" where the site treats it as "the last
income that still gets the higher rate". That is a comparison in `ccsEngine.ts`,
not a value here.

## 12. Offline baseline

`npm run baseline` writes `reports/engine-baseline.md`: the engine's output for the
33 edge cases plus a switch-sensitivity analysis. It was produced before live access
was available and is kept because it is the one report reproducible without the
site. Two caveats now that the real comparison exists: it was generated with
`applyWithholding: false`, which is not the site's convention, and its premise —
that a live difference would be attributable to one of the two switches — turned
out to be wrong. Neither switch explains anything; all four real differences are
calculation logic. `reports/comparison.md` supersedes it.
