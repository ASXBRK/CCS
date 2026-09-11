# Engine baseline — 2026-09-11

CCS year 2026-27. 33 edge cases. Switch settings as checked in:
`percentRounding = { decimals: 2, mode: 'nearest' }`, `applyWithholding = false`.

## 1. Worksheet

What the engine returns, with blank columns for the StartingBlocks figures.
`H` marks a child on the higher rate.

| Case | Income | CCS % | Entitled hrs/fn | Subsidised hrs | Our wk fee | Our wk subsidy | Our wk pay | Our fn pay | SB wk subsidy | SB wk pay | Δ |
|---|---:|---|---:|---|---:|---:|---:|---:|---:|---:|---:|
| edge income 0 one child | 0 | 90 | 100 | 60 | 450.00 | 405.00 | 45.00 | 90.00 |  |  |  |
| edge income 88519 one child | 88,519 | 90 | 100 | 60 | 450.00 | 405.00 | 45.00 | 90.00 |  |  |  |
| edge income 88520 one child | 88,520 | 90 | 100 | 60 | 450.00 | 405.00 | 45.00 | 90.00 |  |  |  |
| edge income 88521 one child | 88,521 | 90 | 100 | 60 | 450.00 | 405.00 | 45.00 | 90.00 |  |  |  |
| edge income 146436 one child | 146,436 | 78.42 | 100 | 60 | 450.00 | 352.89 | 97.11 | 194.22 |  |  |  |
| edge income 146437 one child | 146,437 | 78.42 | 100 | 60 | 450.00 | 352.89 | 97.11 | 194.22 |  |  |  |
| edge income 146438 one child | 146,438 | 78.42 | 100 | 60 | 450.00 | 352.89 | 97.11 | 194.22 |  |  |  |
| edge income 191436 one child | 191,436 | 69.42 | 100 | 60 | 450.00 | 312.39 | 137.61 | 275.22 |  |  |  |
| edge income 191437 one child | 191,437 | 69.42 | 100 | 60 | 450.00 | 312.39 | 137.61 | 275.22 |  |  |  |
| edge income 270726 one child | 270,726 | 53.56 | 100 | 60 | 450.00 | 241.02 | 208.98 | 417.96 |  |  |  |
| edge income 270727 one child | 270,727 | 53.56 | 100 | 60 | 450.00 | 241.02 | 208.98 | 417.96 |  |  |  |
| edge income 360726 one child | 360,726 | 35.56 | 100 | 60 | 450.00 | 160.02 | 289.98 | 579.96 |  |  |  |
| edge income 370725 one child | 370,725 | 33.56 | 100 | 60 | 450.00 | 151.02 | 298.98 | 597.96 |  |  |  |
| edge income 370726 one child | 370,726 | 33.56 | 100 | 60 | 450.00 | 151.02 | 298.98 | 597.96 |  |  |  |
| edge income 538519 one child | 538,519 | 0 | 100 | 60 | 450.00 | 0.00 | 450.00 | 900.00 |  |  |  |
| edge income 538520 one child | 538,520 | 0 | 100 | 60 | 450.00 | 0.00 | 450.00 | 900.00 |  |  |  |
| edge income 538521 one child | 538,521 | 0 | 100 | 60 | 450.00 | 0.00 | 450.00 | 900.00 |  |  |  |
| edge income 100000 two under 6 | 100,000 | 87.7 / 95H | 100 | 60/60 | 900.00 | 822.15 | 77.85 | 155.70 |  |  |  |
| edge income 150000 two under 6 | 150,000 | 77.7 / 93.81H | 100 | 60/60 | 900.00 | 771.80 | 128.21 | 256.41 |  |  |  |
| edge income 200000 two under 6 | 200,000 | 67.7 / 80H | 100 | 60/60 | 900.00 | 664.65 | 235.35 | 470.70 |  |  |  |
| edge income 300000 two under 6 | 300,000 | 47.7 / 70.24H | 100 | 60/60 | 900.00 | 530.73 | 369.27 | 738.54 |  |  |  |
| edge income 365000 two under 6 | 365,000 | 34.7 / 50H | 100 | 60/60 | 900.00 | 381.15 | 518.85 | 1037.70 |  |  |  |
| edge income 371000 two under 6 | 371,000 | 33.5 / 33.5 | 100 | 60/60 | 900.00 | 301.50 | 598.50 | 1197.00 |  |  |  |
| edge fee below cap | 120,000 | 83.7 | 100 | 60 | 360.00 | 301.32 | 58.68 | 117.36 |  |  |  |
| edge fee at cap | 120,000 | 83.7 | 100 | 60 | 455.70 | 381.42 | 74.28 | 148.56 |  |  |  |
| edge fee above cap | 120,000 | 83.7 | 100 | 60 | 600.00 | 381.42 | 218.58 | 437.16 |  |  |  |
| edge participation 48 → 72 hrs | 120,000 | 83.7 | 72 | 72 | 750.00 | 451.98 | 298.02 | 596.04 |  |  |  |
| edge participation 49 → 100 hrs | 120,000 | 83.7 | 100 | 100 | 750.00 | 627.75 | 122.25 | 244.50 |  |  |  |
| edge single parent | 70,000 | 90 | 72 | 60 | 450.00 | 405.00 | 45.00 | 90.00 |  |  |  |
| edge school-age OSHC | 120,000 | 83.7 | 100 | 30 | 150.00 | 125.55 | 24.45 | 48.90 |  |  |  |
| edge FDC | 120,000 | 83.7 | 100 | 60 | 390.00 | 326.43 | 63.57 | 127.14 |  |  |  |
| edge 12hr session over 100 hrs | 120,000 | 83.7 | 100 | 100 | 750.00 | 523.13 | 226.88 | 453.75 |  |  |  |
| edge three children mixed | 180,000 | 71.7 / 71.7 / 83.81H | 100 | 18/60/60 | 990.00 | 764.33 | 225.68 | 451.35 |  |  |  |

## 2. Switch sensitivity

30 of 33 cases change under at least one switch setting.
3 are identical under all six combinations — for those, any
difference against StartingBlocks is an input-mapping or logic question, and no
rounding or withholding setting will close it.

Rounding mode alone (withholding off) moves 26 cases.

| Case | Moved by (Δ weekly subsidy vs checked-in settings) |
|---|---|
| edge income 0 one child | nearest/withheld -20.25 · down/withheld -20.25 · none/withheld -20.25 |
| edge income 88519 one child | nearest/withheld -20.25 · down/withheld -20.25 · none/withheld -20.25 |
| edge income 88520 one child | nearest/withheld -20.25 · down/withheld -20.25 · none/withheld -20.25 |
| edge income 88521 one child | nearest/withheld -20.25 · down/gross -0.04 · down/withheld -20.29 · none/withheld -20.25 |
| edge income 146436 one child | nearest/withheld -17.64 · down/gross -0.04 · down/withheld -17.68 · none/gross -0.01 · none/withheld -17.66 |
| edge income 146437 one child | nearest/withheld -17.64 · down/gross -0.04 · down/withheld -17.68 · none/gross -0.01 · none/withheld -17.66 |
| edge income 146438 one child | nearest/withheld -17.64 · down/gross -0.04 · down/withheld -17.68 · none/gross -0.01 · none/withheld -17.66 |
| edge income 191436 one child | nearest/withheld -15.62 · down/gross -0.04 · down/withheld -15.66 · none/gross -0.01 · none/withheld -15.63 |
| edge income 191437 one child | nearest/withheld -15.62 · down/gross -0.04 · down/withheld -15.66 · none/gross -0.01 · none/withheld -15.63 |
| edge income 270726 one child | nearest/withheld -12.05 · down/gross -0.04 · down/withheld -12.09 · none/gross +0.00 · none/withheld -12.05 |
| edge income 270727 one child | nearest/withheld -12.05 · down/gross -0.04 · down/withheld -12.09 · none/gross +0.00 · none/withheld -12.05 |
| edge income 360726 one child | nearest/withheld -8.00 · down/gross -0.04 · down/withheld -8.04 · none/gross -0.01 · none/withheld -8.01 |
| edge income 370725 one child | nearest/withheld -7.55 · down/gross -0.04 · down/withheld -7.59 · none/gross -0.01 · none/withheld -7.55 |
| edge income 370726 one child | nearest/withheld -7.55 · down/gross -0.04 · down/withheld -7.59 · none/gross -0.01 · none/withheld -7.55 |
| edge income 100000 two under 6 | nearest/withheld -41.11 · down/withheld -41.11 · none/gross +0.02 · none/withheld -41.09 |
| edge income 150000 two under 6 | nearest/withheld -38.59 · down/withheld -38.59 · none/gross +0.03 · none/withheld -38.56 |
| edge income 200000 two under 6 | nearest/withheld -33.23 · down/withheld -33.23 · none/gross +0.02 · none/withheld -33.22 |
| edge income 300000 two under 6 | nearest/withheld -26.53 · down/withheld -26.53 · none/gross +0.03 · none/withheld -26.51 |
| edge income 365000 two under 6 | nearest/withheld -19.05 · down/withheld -19.05 · none/gross +0.02 · none/withheld -19.04 |
| edge income 371000 two under 6 | nearest/withheld -15.07 · down/withheld -15.07 · none/gross +0.04 · none/withheld -15.04 |
| edge fee below cap | nearest/withheld -15.06 · down/withheld -15.06 · none/gross +0.01 · none/withheld -15.05 |
| edge fee at cap | nearest/withheld -19.07 · down/withheld -19.07 · none/gross +0.02 · none/withheld -19.05 |
| edge fee above cap | nearest/withheld -19.07 · down/withheld -19.07 · none/gross +0.02 · none/withheld -19.05 |
| edge participation 48 → 72 hrs | nearest/withheld -22.60 · down/withheld -22.60 · none/gross +0.02 · none/withheld -22.58 |
| edge participation 49 → 100 hrs | nearest/withheld -31.38 · down/withheld -31.38 · none/gross +0.03 · none/withheld -31.36 |
| edge single parent | nearest/withheld -20.25 · down/withheld -20.25 · none/withheld -20.25 |
| edge school-age OSHC | nearest/withheld -6.27 · down/withheld -6.27 · none/gross +0.01 · none/withheld -6.27 |
| edge FDC | nearest/withheld -16.32 · down/withheld -16.32 · none/gross +0.02 · none/withheld -16.30 |
| edge 12hr session over 100 hrs | nearest/withheld -26.16 · down/withheld -26.16 · none/gross +0.02 · none/withheld -26.14 |
| edge three children mixed | nearest/withheld -38.21 · down/withheld -38.21 · none/gross +0.03 · none/withheld -38.19 |

## 3. Signature of each switch

The two switches leave very different sized footprints, which makes a live
difference easy to attribute:

- **Rounding mode** never moves weekly subsidy by more than $0.04 in any case here.
  It only bites where the taper lands on a fraction of a percent.
- **Withholding** always removes exactly 5% of the subsidy — $6.27 to $41.11 a week
  across these cases. A difference that is 5% of the subsidy is the withholding
  switch, never rounding.

So: a difference of a few cents is a rounding question; a difference that is
proportional to the subsidy is a withholding question; anything else is neither.

The sharpest test of rounding mode is **income $88,521** — one dollar over the
first threshold. The exact percentage is 89.9998, so `nearest` shows 90.00% and
`down` shows 89.99%. Whatever StartingBlocks displays there settles the mode on
its own.

## 4. How to read this once live figures exist

- Difference is cents **and** the case appears in section 2 → try the setting named there.
- Difference is cents and the case is **not** in section 2 → not a rounding question.
  Look at the hourly cap and the order children were entered.
- Difference is whole dollars → input mapping. Check, in order: session hours per day,
  days entered per week vs per fortnight, and which child the page put on the higher rate.
