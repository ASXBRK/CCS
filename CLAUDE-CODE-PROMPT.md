# Prompt to paste into Claude Code

Repo: this one. Goal: automate a side-by-side comparison between our CCS engine and https://www.startingblocks.gov.au/child-care-subsidy-calculator and report every difference.

Steps:

1. Read `CLAUDE.md` and `docs/HANDOFF.md` so you know how the engine works and the three rounding/withholding switches.
2. `npm install && npm i -D playwright && npx playwright install chromium` (tsx is already a dev dependency; `npm run compare` uses it).
3. Open `scripts/compare-startingblocks.mjs`. Implement `fillAndRead(page, input)` only. To do that, launch StartingBlocks headed (`--headed`), inspect the multi-step form, and find the selectors for: family income, single/partnered, activity hours per adult, and per child: age or school status, care type, daily fee, hours per day, days (check whether they ask per week or per fortnight — convert). Then find the results panel and read the weekly and fortnightly subsidy and out-of-pocket amounts and the CCS % if shown. Read only; do not calculate in this function.
4. Run `npm run compare -- 10 --headed` first and fix until all 10 read cleanly. Then `npm run compare -- 1000`.
5. Open `reports/comparison.md`. For every FAIL, classify: cents (rounding switch), dollars (input mapping — usually session hours, days per week vs fortnight, or which child got the higher rate), or ERROR (selector). Try the `percentRounding` and `applyWithholding` switches to see which makes the cents cases pass; do not touch anything else in the engine to make a case pass.
6. Report back with: pass/fail count, the switch settings that produced the best match, any case that still fails with the inputs and both sets of figures, and anything StartingBlocks asks for that our engine has no field for.
7. Commit `tests/golden-cases.json` (generated from live results) so `npm run golden` becomes the standing regression. Do not hand-edit expected values.
