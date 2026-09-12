# CCS Calculator — handoff for embedding in the Strategy Builder

This document is for whoever (or whatever, Claude Code included) wires this module into a larger strategy-builder app. It does not assume anything about that app's data model, framework or naming. It explains how this module works, what it needs, and what to look for in the host codebase so the right values flow in — while keeping every value overridable by the adviser.

---

## 1. What this module is

A calculator that reproduces the StartingBlocks.gov.au Child Care Subsidy (CCS) estimate. It answers: for a family with a given income, work pattern and children in care, what does the government pay and what does the family pay, per week, fortnight and year.

It is split so the host app can use as much or as little as it wants:

| Piece | File | What it is |
|---|---|---|
| Rates | `src/ccsRates.ts` | Every threshold, cap and hours figure, keyed by CCS year. Nothing else in the module contains a number. |
| Engine | `src/ccsEngine.ts` | `calculateCcs(input) → result`. Pure function, no framework, no side effects, microseconds to run. |
| Adapter | `src/strategyBuilderAdapter.ts` | Turns "household + life events + overrides" into an engine input, and records where each value came from. This is the piece that needs to be adapted to the host app. |
| UI | `src/CcsCalculator.tsx` | A standalone React screen over the engine. Optional. |
| Tests | `tests/` | Unit tests for every table edge, adapter tests for defaults/life events/overrides, and a golden harness against numbers copied from the live government calculator. |

---

## 2. How the calculation works (so you can sanity-check what the engine returns)

1. **CCS percentage** comes from combined family income.
   - Standard rate: 90% up to $88,520; drops 1 percentage point per $5,000 above that; nil at $538,520.
   - Higher rate for second and younger children aged 5 or under: 95% up to $146,437; tapers to 80% at $191,437; flat 80% to $270,726; tapers to 50% at $360,726; flat 50% up to and including $370,726; from $370,727 every child reverts to the standard rate.
   - The eldest child aged 5 or under is always on the standard rate. Children 6 and over are always standard and do not count toward the higher-rate test.
   - An In Home Care child is always on the standard rate (IHC is subsidised per family, not per child), but still counts toward the two-children test and toward which child is the eldest under six.
2. **Hourly fee** = daily fee ÷ session hours.
3. **Hourly subsidy** = CCS % × the lower of hourly fee and the hourly cap (2026-27: $15.19 below school age / $13.30 school age for centre-based and OSHC; $14.08 family day care; $41.31 in-home care).
4. **Subsidised hours** per fortnight = the lower of hours attended and the entitlement. Entitlement is 72 hours for every eligible family (the 3 Day Guarantee, from 5 January 2026); 100 hours if the adult with the fewer recognised-participation hours does more than 48 hours a fortnight, or the child is First Nations, or an exemption applies.
5. **Subsidy** = hourly subsidy × subsidised hours, where the hourly subsidy is first rounded to the cent (as Services Australia and StartingBlocks do). Optionally shown after the 5% Services Australia withholds until end-of-year balancing.
6. **Out of pocket** = fees − subsidy. Weekly is each child's fortnight halved and rounded, then summed (how StartingBlocks builds its weekly family total); yearly is 26 fortnights.

Everything the engine returns is per child and as family totals, with intermediate values (hourly fee, capped fee, hourly subsidy, subsidised vs unsubsidised hours) exposed so the host app can explain the number, not just display it.

---

## 3. What the engine needs, and where to find it in the host app

The engine's input is small. For each field, here is what it means and what to look for in the strategy builder.

### Family income → `familyIncome`

CCS uses **adjusted taxable income (ATI)** for the family: taxable income plus reportable fringe benefits, reportable super contributions, net investment losses and certain tax-free pensions, less child support paid. Combined across both adults when partnered.

Tips:
- If the strategy builder already calculates ATI for another measure (Division 293, private health rebate, Family Tax Benefit, HELP repayment income is close but not identical), pull that. It is the right number.
- If it only has **taxable income**, pull that as the starting point. For most accumulator clients without salary packaging or large investment losses it is close enough, and it is far better than making the adviser retype it.
- If it has salary and the builder models salary sacrifice, remember reportable super contributions are added back — the sacrifice does not reduce CCS income.
- Sum both adults when partnered; one adult when single.

### Single or partnered → `partnered`

This is a gate the engine needs for two things: whether to sum two incomes, and whether the 100-hour test uses the lower of two adults' participation or just one.

Tips:
- The strategy builder almost certainly already has this (relationship status, number of adults, spouse present). Read it from there rather than asking again.
- Where the builder holds a "spouse" object that may be null, `partnered = spouse != null`.

### Participation hours → `participationHours.adult1 / adult2`

Recognised participation is paid work, study, training, volunteering, job search, or parental leave, in hours per fortnight. The engine only cares whether the lower adult is above 48.

Tips:
- If the builder holds work pattern as **days per fortnight** (or days per week, or FTE), convert: days per fortnight × hours per day (7.6 is a sensible default for full-time). The adapter does this if you give it `workDaysPerFortnight`.
- If it holds **hours per week**, double it.
- If it only holds employment status (full-time / part-time / not working), map full-time → 76, part-time → ask or default to 38, not working → 0. Flag the default in the UI.
- Do not spend effort modelling participation precisely. The only threshold that matters is 48, and most working couples clear it. The interesting case is the "reduce work" life event pushing one adult from above 48 to at or below it.

### Days of care → `careDaysPerWeek`, `familySupportDaysPerWeek`

The engine takes days per fortnight, but nobody thinks in days per fortnight.
The adapter takes the week instead:

| Field | Meaning |
|---|---|
| `careDaysPerWeek` | days the child needs minding — normally the days the primary carer works |
| `familySupportDaysPerWeek` | of those, the days family covers for free |
| `daysPerFortnight` | escape hatch: an explicit fortnightly figure, overrides both |
| `hoursPerFortnight` | second escape hatch, for weeks that do not divide into whole days |

Days in paid care = `careDaysPerWeek − familySupportDaysPerWeek`, doubled for
the fortnight. Left undefined, `careDaysPerWeek` is derived from the work
pattern: for a couple, the days the **lesser-working** parent works, since the
other is at work on all of them; for a single parent, their own work days. That
is a guess and is marked `default` in provenance.

Family support matters more than it looks. One grandparent day a week is a fifth
off the fee and a fifth off the subsidy, and families routinely have one.
Modelling a return to work without asking about it overstates the cost of going
back.

### Children → `children[]`

Per child: age in years, whether they attend school, care type, daily fee, session hours, days per fortnight.

Tips:
- Age and count of dependants are almost certainly in the builder. Pull them. `schoolAge` can default from age (6 and over) and be flipped by the adviser.
- Care type, fee, session hours and days are unlikely to be in the builder. Use the defaults in the adapter (`CARE_DEFAULTS`) and show them clearly as defaults so the adviser overrides them from the fact find.

  The fee and session defaults are **StartingBlocks' own national averages**, read off the live calculator on 2026-09-11 — the figures behind its "use the national average for my type of service" checkbox:

  | Care type | Daily fee | Hours a day | Source |
  |---|---:|---:|---|
  | Centre based day care | $120 | 10 | national average |
  | Family day care | $110 | 10 | national average |
  | Outside school hours care | $32 | 3 | national average |
  | In home care | $400 | 10 | estimate |

  In Home Care has no published average and no checkbox on the site. It is charged per family per hour, so $400 over a 10-hour day is $40/hr — just under the $41.31 cap, which is where these services sit in practice. It carries `source: 'estimate'`, and the assumption note calls it an estimate rather than an average.

  A firm with its own local fee data should replace these and change `source` with them, since that field decides how the note describes the number.
- Only children marked "in care" go to the engine. A child who is not in care simply does not appear.

### Withholding → `applyWithholding`

Whether to show amounts after the 5% Services Australia holds back. Default off. The government calculator's convention should be confirmed during golden testing; match it.

---

## 4. The override rule

**Every value the adapter derives must remain overridable by the adviser, including income.** This is deliberate and non-negotiable.

Reasons:
- The builder's taxable income is not always CCS income (see ATI above). The adviser may know the client has reportable fringe benefits or an investment loss the builder does not model.
- The client may have given Services Australia a different estimate, and the adviser may want to model what Services Australia will actually pay.
- Participation defaults are guesses. Care fees are guesses. The adviser has the fact find.

How the adapter does it: `deriveCcsInputs(household, lifeEvents, overrides)` applies strict precedence — **override > life event > household value > default** — and returns a `provenance` map giving the source of every field. The UI should render that source next to each field (from fact find / from life event / default / overridden) so it is obvious when a number is a guess.

When wiring into the host app: store the adviser's overrides as a separate object keyed to the client and scenario, never by mutating the household record. That keeps the fact-find data clean and lets the adviser clear an override to return to the derived value.

---

## 5. Life events

The adapter accepts a small set of events and applies them before deriving inputs:

- `reduceWork` / `increaseWork` — change an adult's days per fortnight. By default this scales that adult's income pro rata by days and recomputes participation. If the builder already models the new salary (it probably does, and its number will be better than pro rata), pass it as `newAtiAnnual` instead. For `reduceWork` the adapter also pulls each child's care days down to the new work days where they exceed it, on the assumption that fewer work days means fewer care days. That is a smart default; the adviser overrides it if the client keeps the same days.
- `incomeChange` — set an adult's income directly.
- `childStartsCare` / `childLeavesCare` / `changeCareDays` — self-explanatory.

`compareLifeEvent(household, events, overrides)` returns before, after and the annual difference in fees, subsidy and out-of-pocket. That is the number a strategy comparison should show: "reducing to 8 days a fortnight costs $X in salary and saves $Y in child care".

Tips:
- Map the builder's own event vocabulary onto these rather than extending the adapter. If the builder has "go part-time from July 2027", that is a `reduceWork` on that adult with a date; the engine is not date-aware, so run it once for each year of the projection with that year's income.
- If the builder projects income year by year, run the engine once per year with that year's family income. It is cheap. Keep the rates keyed by CCS year so future indexation can be added without touching the engine.

---

## 6. Wiring steps

1. Copy `src/ccsRates.ts`, `src/ccsEngine.ts` and `src/strategyBuilderAdapter.ts` into the host app's calculation layer, wherever comparable measures live (Div 293, HELP, PHI rebate and the like). Keep the rates in their own file.
2. Write a thin mapper from the host's household type to the adapter's `SbHousehold` shape. Do the field-hunting from section 3 here. Do not rename the adapter's fields; map to them, so its tests keep passing.
3. Add CCS to cash flow: annual out-of-pocket is an expense line; annual subsidy is a reduction of that expense, not income. Use `result.totals.perYear`.
4. Wire life events as in section 5 and recalculate on every change; the engine is synchronous and effectively free.
5. Surface an override panel that mirrors the engine input, pre-filled from `derived.engineInput`, with provenance badges. Income, participation and every child field must be editable there.
6. Copy `tests/` into the host test suite (written for vitest; adjust imports for jest).
7. Copy `ccs-calculator.html` somewhere reachable so advisers can compare against StartingBlocks without running the app.

---

## 7. Proving it matches StartingBlocks

The engine implements the legislated formula the government calculator uses. What could not be confirmed without their client-side code is rounding and display convention. There are exactly three switches for this:

| Switch | Where | Options |
|---|---|---|
| CCS % rounding | `percentRounding` in `ccsRates.ts` | 2 decimals nearest (Services Australia convention) / down / none |
| Withholding | `applyWithholding` on the input | on / off |
| Default session hours per care type | `DEFAULTS.hoursPerDay` in the adapter | match what StartingBlocks pre-fills |

Procedure:
1. Open `ccs-calculator.html` and StartingBlocks side by side. Enter a dozen cases covering: one child; two children under 6; a school-age child in OSHC; fee below and above the cap; income just either side of $88,520, $146,437 and $370,726; participation of 48 vs 49 hours. Type StartingBlocks' figures into the comparison panel; it shows match or the difference and records a golden case. Download `golden-cases.json` into `tests/` and run `npm run golden`.
2. Differences of cents → change the rounding switch, re-run. Differences of dollars → an input mismatch, almost always session hours or which child is treated as the standard-rate child.
3. For bulk coverage: `npm run gen-cases > tests/golden-inputs.json` produces 1,000 inputs hitting every threshold edge. A Playwright script that fills the StartingBlocks form from each and records the displayed results into `golden-cases.json` finishes the job. It has to be written against the live page (selectors are not known here) — a short task with the browser open. Keep it and re-run it every 6 July after indexation.

Never edit expected values in `golden-cases.json` to make a test pass. They are what the government tool showed.

---

## 8. Annual maintenance

Each June the Department of Education publishes the next year's thresholds and caps. Add a new key to `CCS_RATES` in `ccsRates.ts` (copy the previous year, update the numbers, set `effectiveFrom` to the first Monday of July), point `CURRENT_CCS_YEAR` at it, and re-run the golden harness against the live calculator. Keep prior years so historical scenarios still reproduce.

## 9. Known simplifications (shared with StartingBlocks)

- In-home care cap is per family; applied per child here (flagged in `warnings`). StartingBlocks does not model a second In Home Care child at all — it renders `-` for every figure of the second and later such child — so this cannot be reconciled against it. The engine still costs both, which is the safer side to err on for advice.
- An In Home Care child is always paid the standard rate, never the higher one, though it still counts toward the two-children test and toward which child is the eldest under six. Confirmed against the live calculator and against Services Australia guidance.
- No Additional Child Care Subsidy, no preschool-year exemptions.
- Session hours count in full even if the child attends fewer hours; that is how CCS works.
- Income is one annual figure per run; run per year for projections.
