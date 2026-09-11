# StartingBlocks comparison — where this stands

**Status: the comparison has now run against the live site.**
Date of run: 2026-09-11. Site: `https://www.startingblocks.gov.au/child-care-subsidy-calculator`.

Reproduce with:

```
npm install
npm run compare -- --dump     # record every control the form exposes → reports/dom-dump.md
npm run compare -- 10         # smoke run
npm run compare -- 500        # full run → reports/ and tests/golden-cases.json
```

`--headed` still exists but is not needed; the walk is stable headless.

---

## 1. Headline

The engine reproduces every **rule** the government calculator applies — thresholds,
tapers, hourly rate caps, which child gets the higher rate, the 48-hour activity
boundary, the school-age boundary, and the rounding of the CCS percentage. All of
those were confirmed against the live tool, not assumed.

It differs from the site in exactly **one arithmetic step**, described in section 5.
That step is inside `src/ccsEngine.ts`, which this work was not permitted to change,
so it has been recorded rather than fixed. Every remaining difference in
`reports/comparison.md` traces to it.

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

## 5. The one difference that remains

Reverse-engineered from the live figures and confirmed against every case, the site
computes, per child:

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
only rounds the fortnightly total. The reported `hourlySubsidy` field *is* rounded,
so the gap is invisible in the per-child output and only shows in the totals.

**Size of the gap:** at most half a cent per subsidised hour, so up to $0.50 per
fortnight at the 100-hour entitlement, and typically 10–30 cents. It is always
smaller than the tolerance the golden harness uses is large — that is, it is real
but tiny, and it never changes a rule, only a rounding.

**It cannot be closed with either switch.** `percentRounding` only rounds the
percentage, and this rounding is one multiplication later. Withholding is already
on. The fix is a one-line change inside `calculateCcs`, which was out of scope for
this work, so it is recorded here and not made.

A reader who wants to confirm the attribution can run the model above over the
golden file: it reproduces the site's fortnightly gross subsidy and out-of-pocket
for every case that the engine misses.

One footnote on that model. The site's arithmetic is IEEE-754 double precision and
the rounding is plain half-up, so an hourly subsidy that lands exactly on a
half-cent resolves according to how the decimal happens to be representable.
`47.70% × $15.00` is stored a hair below `7.155` and rounds to `7.15`; `51.70% ×
$15.00` is stored a hair above `7.755` and rounds to `7.76`. Reproducing the site
to the cent means computing the rate as a 4-decimal fraction, not as `percent/100`.

## 6. What was confirmed, and needed no change

Each of these was checked against the live tool and matches the engine exactly:

- **Hourly rate caps.** $15.19 below school age and $13.30 school age for centre
  based care and OSHC, $14.08 family day care, $41.31 in home care. Derived by
  driving the fee far above the cap and solving back from the displayed subsidy.
- **Percentage rounding: two decimals, nearest.** The setting in `ccsRates.ts` was
  already right and has **not** been changed. Settled by two probes an
  income apart, both at the in-home-care cap where the difference is largest:
  income $88,521 (exact 89.9998%) displayed a subsidy consistent with 90.00%, ruling
  out rounding down; income $88,546 (exact 89.9948%) displayed one consistent with
  89.99%, ruling out not rounding at all. Only "nearest, 2 dp" satisfies both.
- **The 48-hour activity boundary.** Exactly 48 hours for the lower adult gives 72
  subsidised hours; 49 gives 100. The engine's "strictly more than 48" is right, and
  the summaries that write the band as "48+" are wrong.
- **School age starts at 6.** A five-year-old in OSHC gets the $15.19 cap, a
  six-year-old the $13.30 cap.
- **Higher-rate selection.** The eldest child aged 5 or under takes the standard
  rate and the younger ones the higher rate; children 6 and over take the standard
  rate and do not count toward the test, so a 7-year-old plus a 1-year-old puts
  both on the standard rate.
- **Income thresholds and tapers**, at every threshold ± $1.

## 7. What the site asks that the engine has no field for

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

The site also asks for nothing the engine ignores. Every control on the form maps
onto an engine input.

## 8. Rates check

The thresholds, tapers and hourly caps in `src/ccsRates.ts` were cross-checked
against the 2026-27 figures in the `au-fy-figures` reference before this run, and
have now been confirmed a second time against the live calculator. No differences.

## 9. Offline baseline

`npm run baseline` writes `reports/engine-baseline.md`: the engine's output for the
33 edge cases plus a switch-sensitivity analysis. It was produced before live access
was available and is kept because it is the one report reproducible without the
site. Note it was generated with `applyWithholding: false`, which is *not* the
site's convention — the live comparison in `reports/comparison.md` supersedes it.
