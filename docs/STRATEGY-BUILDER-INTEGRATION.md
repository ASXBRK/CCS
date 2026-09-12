# Wiring child care into the Strategy Builder

For whoever builds the Strategy Builder side. This says what the module gives
you, what the flow should feel like, and the handful of things that will bite.

Read `HANDOFF.md` for how the calculation works. This file is only about the
integration.

---

## 1. What this replaces

Today a child care life event is a generic ongoing cost change: pick a from
date, type an amount, pick a frequency, pick an until date, type "child care
costs", and there is a link off to the StartingBlocks calculator so the adviser
can work the number out by hand and come back.

That link is the problem. The adviser leaves the tool, re-enters the family by
hand, reads a number off a government page, and types it back in. Every one of
those steps can go wrong, and none of the assumptions behind the number survive
into the plan.

The new flow: **click Child care, give it a date, and the amount is already
there.** Nine times out of ten that is the whole interaction.

---

## 2. The one call

```ts
import { calculateForHousehold } from './ccs/strategyBuilderAdapter';

const { result, derived, note } = calculateForHousehold(household, lifeEvents, overrides);
```

- `result.totals.perFortnight.outOfPocket` → the amount on the cost change
- `note` → one plain sentence of assumptions, for the adviser and the client
- `derived.provenance` → per field, whether it came from the fact find, a life
  event, an override, or a default

Nothing else needs calling. The engine is synchronous and effectively free —
run it on every keystroke if you like.

---

## 3. The zero-touch path

A bare child care event needs **a child's age and the household you already
have**. Everything else derives:

| Field | Where it comes from with no adviser input |
|---|---|
| Family income | Sum of the adults' ATI already in the builder |
| Partnered | The builder's own relationship status |
| Participation hours | Each adult's work days × 7.6 × 2 |
| Care type | Centre based day care, or OSHC once the child is at school |
| Daily fee | StartingBlocks' national average for that care type |
| Session length | Same source |
| Days needing care | The **lesser-working** parent's days a week — the other is at work on all of them |
| Family support | Nil |

Worked example. Mum on $60k going back 3 days a week, dad on $110k full time,
one child aged 2, nothing else supplied:

```
derived child: { ageYears: 2, careType: 'CBDC', dailyFee: 120,
                 hoursPerDay: 10, daysPerFortnight: 6 }
fortnightly out of pocket: $216.12      yearly: $5,619.12
```

That is the number that lands on the cost change, with no further input.

---

## 4. Mapping onto the cost change record

| Your field | Value |
|---|---|
| Amount | `result.totals.perFortnight.outOfPocket` |
| Frequency | Fortnightly — CCS is administered per fortnight, so this is the native period. Everything else is derived from it. |
| From | The event date |
| Description | Keep "Child care costs" |
| Notes / assumptions | `note` |

**Do not** store the number alone. Store the derived inputs beside it, or the
plan cannot be re-run when the rates index each July and nobody will know what
the figure assumed.

---

## 5. The return-to-work link

The return-to-work event already asks for days a week and scales salary pro
rata — three days becomes 60% of current salary. **That same number drives
three things**, which is why the two events belong together:

1. Income — pro rata, as you already do
2. Recognised activity hours — days × 7.6 × 2
3. Days the child needs care — the days the returning parent works

So offer a tick box on return to work: *also add child care*. Ticked, it emits
both events off the one number and the adviser types nothing else. The child
care event should also stand alone, for a family whose care arrangements change
without anyone's work changing.

### The thing to get right: three days a week misses the activity test

The 100-hour entitlement needs **more than 48 hours** of recognised activity a
fortnight from the lower-participation adult. At 7.6 hours a day:

| Days a week | Hours a fortnight | Subsidised hours |
|---|---:|---:|
| 2 | 30.4 | 72 |
| 3 | 45.6 | **72** |
| 3.5 | 53.2 | 100 |
| 4 | 60.8 | 100 |
| 5 | 76 | 100 |

The cliff falls between three and four days — exactly where a return-to-work
conversation lands. Three days a week does **not** clear it.

Whether that costs anything depends on how much care the child is actually in.
Against a 72-hour entitlement, at 10-hour days:

| Care days a week | Hours a fortnight | |
|---|---:|---|
| 3 | 60 | within the 72 |
| 4 | 80 | **8 hours unsubsidised** |
| 5 | 100 | **28 hours unsubsidised** |

So the case that hurts is a parent working three days but keeping the child in
care four — common enough, for continuity or a fixed centre roster. In the
example above it takes the fortnightly cost from $216.12 to $355.34, and about
$96 of that jump is care at full price rather than the extra day itself.

Surface this. An adviser who does not know it will quote a return to three days
and be wrong about why the subsidy dropped.

---

## 6. Edit assumptions

One button behind the auto-calculated figure. Order it by how often it is
actually touched:

1. **Days a week needing care** — the most common change, and the first thing an
   adviser will correct
2. **Days a week of family support** — a grandparent covering a day. Free, so it
   cuts the fee and the subsidy together. Families routinely have one, and
   modelling a return to work without asking overstates the cost
3. **Daily fee** — replace the national average with the actual centre
4. **Session length** — 10 hours for long day care, 3 for outside school hours
5. **Care type** — centre based, family day care, outside school hours, in home
6. **Family income** — the builder's taxable income is not always CCS income
   (see HANDOFF §3 on adjusted taxable income)
7. **Hours a fortnight** — the escape hatch for a week that does not divide into
   whole days. Rarely needed; keep it out of the way

Every one must stay overridable, including income. Show the provenance badge
from `derived.provenance` next to each, so a default never looks like a fact.

---

## 7. Things that will bite

**Child care does not stop, it changes.** When the child starts school the cost
does not go to zero — it becomes outside school hours care, at a different cap
($13.30 rather than $15.19), a different fee and a much shorter session.
Consider emitting two cost lines rather than one with an until date: centre
based to school age, OSHC after. At minimum do not let an adviser set an until
date at school age and quietly assume the cost ends.

**Children age through a projection.** The engine takes an age at a point in
time. The higher rate stops at 6, and the cap changes when the child starts
school. Run the engine once per projection year with that year's age and that
year's income; it is cheap.

**The 5% withholding is a timing difference, not a cost.** Defaults to on,
because that is what StartingBlocks shows. The fortnightly figure with it on is
what leaves the bank account; the same figure with it off is what the year
actually costs, because the 5% comes back at balancing if the income estimate
holds up. Cash flow wants the first, the plan wants the second, and
`result.totals.perYear.withheld` is the difference. The note states both.

**Two children under 6 is not twice one child.** The second and younger get the
higher rate, so the second child is materially cheaper than the first. Do not
let anyone estimate by doubling.

**In home care** is a family arrangement, not a per-child one, and is always
paid the standard rate. StartingBlocks will not model a second in-home-care
child at all. Rare, but the warnings on `result.warnings` say so — surface them.

---

## 8. What not to do

- **Do not re-implement the calculation.** It is 493 golden cases against the
  live government calculator and it took real work to reconcile. Call it.
- **Do not hard-code a threshold, cap or rate anywhere.** They all live in
  `ccsRates.ts` and change every July.
- **Do not quote a figure without its assumptions.** A client using two days of
  family support who reads a figure built on none will plan around the wrong
  number. That is what `note` is for.
- **Do not present the estimate as an entitlement.** Services Australia
  determines the actual subsidy. The wording on the standalone calculator —
  "Estimate only; Services Australia determines entitlement" — should follow the
  figure wherever it appears.
