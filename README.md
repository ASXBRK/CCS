# CCS Calculator

Australian Child Care Subsidy calculator (CCS year 2026-27) built to give the same results as StartingBlocks.gov.au, plus an adapter for embedding in a broader strategy-builder app.

## Test without installing anything
Open `ccs-calculator.html` in a browser. It runs the same engine, lets you enter what StartingBlocks shows for the same inputs, flags any difference, and exports `golden-cases.json`.

## Run the app
```
npm install
npm run dev        # standalone React calculator at http://localhost:5173
npm test           # unit + adapter tests
npm run golden     # regression against tests/golden-cases.json
npm run typecheck
```

## Layout
- `src/ccsRates.ts` — every threshold, cap and hour figure; the only file to change at annual indexation
- `src/ccsEngine.ts` — pure calculation
- `src/strategyBuilderAdapter.ts` — household + life events + overrides → engine input, with provenance
- `src/CcsCalculator.tsx` — standalone UI
- `tests/` — unit, adapter and golden tests; `scripts/generate-cases.mjs` emits bulk inputs
- `docs/HANDOFF.md` — how to embed this in another codebase
- `docs/STRATEGY-BUILDER-INTEGRATION.md` — the Strategy Builder flow: one click, defaults that hold, and the return-to-work link
- `docs/STRATEGY-BUILDER-PROMPT.md` — paste this into the Strategy Builder's Claude Code session to start the work
- `CLAUDE.md` — working rules for Claude Code
