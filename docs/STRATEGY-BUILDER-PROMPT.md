# Prompt to paste into the Strategy Builder's Claude Code session

Copy everything below the line.

---

Add automatic Child Care Subsidy costing to the Strategy Builder, replacing the
manual child care life event.

## Where the module is

It lives in its own repo: `https://github.com/ASXBRK/CCS`, branch
`claude/tender-goodall-ugewt0`. Clone it somewhere you can read, or add it as a
source.

Read these first, in this order, before writing anything:

1. `docs/STRATEGY-BUILDER-INTEGRATION.md` — the flow to build, what derives with
   no adviser input, the return-to-work link, and the things that will bite.
   This is the brief; the rest is background.
2. `docs/HANDOFF.md` — how the calculation works and what each input means,
   particularly §3 on finding the right income and work pattern in a host app.
3. `src/strategyBuilderAdapter.ts` — the API you will call. `CARE_DEFAULTS`,
   `deriveCcsInputs`, `calculateForHousehold`, `buildAssumptionNote`.
4. `src/ccsEngine.ts` and `src/ccsRates.ts` — skim only. Pure, framework-free,
   and not yours to change.

Copy `src/ccsRates.ts`, `src/ccsEngine.ts` and `src/strategyBuilderAdapter.ts`
into wherever our other calculators live (Division 293, HELP, private health
rebate and the like), and copy `tests/` across with them. Keep the rates in
their own file. Do not rename the adapter's fields — write a thin mapper from
our household type onto its `SbHousehold` shape, so its tests keep passing.

## What exists today, and what replaces it

Today: life events → child care gives a generic ongoing cost change. From date,
manual amount, frequency, until date, description "child care costs", and a link
off to the StartingBlocks calculator so the adviser can work the number out by
hand and type it back in.

That link is what we are removing. Clicking Child care and giving it a date
should produce the amount with no further input. Nine times out of ten that is
the whole interaction.

## Build it in this order

1. **The zero-touch path.** A child care life event with a date and nothing else
   produces a costed cost change. Everything derives from the household we
   already hold — see §3 of the integration brief for the full table. Put
   `result.totals.perFortnight.outOfPocket` on the cost change at fortnightly
   frequency, and store the derived inputs beside it, not just the number.

2. **An "Edit assumptions" button** behind the figure. Ordered as in §6 of the
   brief: days a week needing care first, then days a week of family support,
   then fee, session length, care type, income, and the hours escape hatch last.
   Every field stays overridable, including income, and each shows where its
   current value came from — the adapter returns that in
   `derived.provenance`.

3. **The return-to-work link.** That event already asks for days a week and
   scales salary pro rata. Add a tick box: *also add child care*. Ticked, it
   emits both events off the one number — the same days figure sets the salary,
   the recognised activity hours and the days the child needs care. Child care
   must still work standalone.

4. **Surface the activity-test cliff.** Read §5 of the brief. Three days a week
   is 45.6 recognised hours a fortnight, which does not clear the 48-hour test,
   so the family gets 72 subsidised hours rather than 100. It costs real money
   when care runs past 72 hours a fortnight — a parent working three days but
   keeping the child in care four. Show this where the adviser will see it, not
   in a tooltip.

## Rules

- **Do not re-implement the calculation.** It reconciles against 493 cases taken
  from the live government calculator. Call it.
- **Do not hard-code a threshold, cap, rate or fee** anywhere outside
  `ccsRates.ts` and `CARE_DEFAULTS`. They change every July.
- **Always carry `note` with the figure.** `calculateForHousehold` returns one
  plain sentence of the assumptions behind the number, including which values
  were defaults rather than fact-find data. A client using two days of family
  support who reads a figure built on none will plan around the wrong number.
- **Never present it as an entitlement.** "Estimate only; Services Australia
  determines entitlement" follows the figure wherever it appears.
- Run the host's tests and typecheck before you finish.

## Done looks like

An adviser opens a client, adds a return-to-work life event at three days a
week, ticks "also add child care", and sees a fortnightly child care cost on the
plan with a sentence explaining what was assumed — without opening
StartingBlocks, and without typing a number.

Ask before changing anything inside `ccsEngine.ts` or `ccsRates.ts`. If the
calculation looks wrong, it is more likely the mapping into `SbHousehold`; check
that first and raise it rather than editing the engine.
