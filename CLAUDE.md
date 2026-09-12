# CCS Calculator — notes for Claude Code

Read `docs/HANDOFF.md` first. It explains what this module is, how the calculation works, and how to wire it into another codebase.

Rules for this repo:
- `src/ccsRates.ts` holds every number. Never hard-code a threshold or cap anywhere else.
- `src/ccsEngine.ts` is pure and framework-free. Keep it that way.
- `ccs-calculator.html` inlines a copy of the engine for no-install testing. If you change the engine, change the HTML copy too.
- `tests/golden-cases.json` is the source of truth for "matches StartingBlocks.gov.au". Never edit expected values to make a test pass; fix the engine or the rounding switch.
- Run `npm test` and `npm run typecheck` before finishing any change.

## When the Strategy Builder quotes a child care number

Advisers work in **days per week**, not days per fortnight. Take
`workDaysPerWeek` and `careDaysPerWeek`; the fortnightly fields still work but
are not the ones to reach for.

Days needing care are not the same as days in paid care. Families often have a
grandparent covering a day. Ask for `familySupportDaysPerWeek` and subtract it —
a day of family support is a day of fees and subsidy that does not happen.
`hoursPerFortnight` is there for the edge cases that do not divide into whole
days; most of the time it should be left alone.

Fee and session defaults live in `CARE_DEFAULTS` and are StartingBlocks' own
national averages, not round numbers someone picked. Do not change one without
a source, and set its `source` to match — that field is what makes the note say
"the national average for centre based day care" rather than "an estimate".

**Always show the assumption note with the figure.** `calculateForHousehold`
returns it as `note`, and it reads like this:

> We have assumed you work 3 days a week, your partner works 5 days a week, your
> child needs care 3 days a week, with 1 day of family support and 2 days in
> child care. After subsidy that is $133.80 a fortnight ($3,478.80 a year), with
> the government paying $466.20 a fortnight.

The number means nothing without the assumptions behind it — a client who is
actually using two days of family support will read a figure built on none and
plan around it. The note also names any figure that came from a default rather
than the fact find, so a guessed daily fee never reads like a quote. If you
build the sentence yourself rather than using `note`, keep both of those
properties.
