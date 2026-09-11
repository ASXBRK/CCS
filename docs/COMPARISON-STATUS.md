# StartingBlocks comparison — where this stands

## The blocker

The comparison never ran. The session it was set up in sits behind an egress
allow-list that does not include `www.startingblocks.gov.au`; the proxy answers
403 to the CONNECT, and Chromium reports `ERR_TUNNEL_CONNECTION_FAILED`. General
web access is off, not just this host — `example.com` fails the same way.

Nothing in the harness needs to change to fix this. Run it from a machine that
can reach the site.

## What is ready

```
npm install
npm run compare -- 10 --headed     # 10 cases, watch it drive the form
npm run compare -- 500             # full run, writes reports/ and tests/golden-cases.json
npm run compare -- --dump          # no filling: record every field the form exposes
```

`fillAndRead` is implemented. It walks the wizard without assuming a field
order: on each step it reads every visible control, fills the ones it
recognises, presses Next, and repeats until the results panel appears. Fields
are matched on their visible wording, not on CSS classes or generated ids,
because a Next.js deploy changes those and the wording survives.

**It has never been run against the live DOM.** The matchers are informed
guesses at how the questions are worded. Expect the first run to need a pass of
corrections.

## Correcting the matchers

Run `npm run compare -- --dump`. It writes `reports/dom-dump.md`: every control
on every step, with its accessible name, type and options. Then edit the `M`
object at the top of `scripts/compare-startingblocks.mjs` — one list of
alternative wordings per field, nothing else to touch.

Two conversions are handled from the page's own labels rather than assumed, and
both are worth checking against the dump on the first run:

- days per week vs per fortnight
- activity hours per week vs per fortnight

A field whose label says "week" (and not "fortnight") gets half the fortnightly
figure. If the form says neither, the value goes in as a fortnightly number and
that is probably wrong.

## What was done without the site

`npm run baseline` writes `reports/engine-baseline.md`: the engine's output for
all 33 edge cases, as a worksheet with blank columns for the StartingBlocks
figures, plus a switch-sensitivity analysis.

The useful result from it is that the two switches have very different
footprints, so a live difference can be attributed on sight:

- rounding mode moves weekly subsidy by at most 4 cents
- withholding removes exactly 5% of the subsidy, $6 to $41 a week here

A few cents is rounding. Something proportional to the subsidy is withholding.
Anything else is neither, and no switch will close it.

The single sharpest case is **income $88,521**, one dollar over the first
threshold. The exact percentage is 89.9998, so `nearest` displays 90.00% and
`down` displays 89.99%. Whatever the site shows there settles the rounding mode
by itself.

## Rates check

The thresholds, tapers and hourly caps in `src/ccsRates.ts` were cross-checked
against the 2026-27 figures in the `au-fy-figures` reference. No differences.

One boundary is worth confirming against the live site: the engine gives 100
hours only when the lower adult's activity is **more than** 48 hours a
fortnight, so exactly 48 gets 72. That matches the legislation. Some summaries
write the band as "48+", which would put 48 on 100 hours.
