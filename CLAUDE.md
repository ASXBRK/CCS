# CCS Calculator — notes for Claude Code

Read `docs/HANDOFF.md` first. It explains what this module is, how the calculation works, and how to wire it into another codebase.

Rules for this repo:
- `src/ccsRates.ts` holds every number. Never hard-code a threshold or cap anywhere else.
- `src/ccsEngine.ts` is pure and framework-free. Keep it that way.
- `ccs-calculator.html` inlines a copy of the engine for no-install testing. If you change the engine, change the HTML copy too.
- `tests/golden-cases.json` is the source of truth for "matches StartingBlocks.gov.au". Never edit expected values to make a test pass; fix the engine or the rounding switch.
- Run `npm test` and `npm run typecheck` before finishing any change.
