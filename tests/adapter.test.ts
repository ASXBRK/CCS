import { describe, it, expect } from 'vitest';
import { calculateForHousehold, compareLifeEvent, SbHousehold } from '../src/strategyBuilderAdapter';

const household: SbHousehold = {
  partnered: true,
  adults: [
    { id: 'brent', atiAnnual: 120_000, workDaysPerFortnight: 10 },
    { id: 'jane', atiAnnual: 90_000, workDaysPerFortnight: 10 },
  ],
  children: [
    { id: 'c1', ageYears: 2, inCare: true, careType: 'CBDC', daysPerFortnight: 10, dailyFee: 160, hoursPerDay: 10 },
  ],
};

describe('strategy builder adapter', () => {
  it('derives income and participation from the household', () => {
    const { result, derived } = calculateForHousehold(household);
    expect(derived.engineInput.familyIncome).toBe(210_000);
    expect(derived.provenance.familyIncome.source).toBe('household');
    expect(derived.engineInput.participationHours).toEqual({ adult1: 76, adult2: 76 });
    expect(result.entitledHoursPerFortnight).toBe(100);
    expect(result.children[0].subsidisedHoursPerFortnight).toBe(100);
  });

  it('fills defaults for missing child fields and records the source', () => {
    const h: SbHousehold = { ...household, children: [{ id: 'c1', ageYears: 2, inCare: true }] };
    const { derived } = calculateForHousehold(h);
    expect(derived.engineInput.children[0].hoursPerDay).toBe(10);
    expect(derived.provenance.children.c1.dailyFee.source).toBe('default');
  });

  it('applies "reduce work by 2 days a fortnight": income, participation and care days all move', () => {
    const cmp = compareLifeEvent(household, [{ type: 'reduceWork', adultId: 'jane', daysPerFortnight: 8 }]);
    const after = cmp.after.derived.engineInput;
    expect(after.familyIncome).toBe(120_000 + 72_000);
    expect(after.participationHours.adult2).toBeCloseTo(60.8, 5);
    expect(after.children[0].daysPerFortnight).toBe(8);
    expect(cmp.after.derived.provenance.children.c1.daysPerFortnight.source).toBe('lifeEvent');
    expect(cmp.after.result.entitledHoursPerFortnight).toBe(100); // 60.8 > 48
    expect(cmp.deltaPerYear.fees).toBeLessThan(0);
  });

  it('drops to 72 hours when reduced work takes participation to 48 or below', () => {
    const { result } = calculateForHousehold(household, [{ type: 'reduceWork', adultId: 'jane', daysPerFortnight: 6 }]);
    expect(result.entitledHoursPerFortnight).toBe(72);
  });

  it('overrides beat life events and defaults', () => {
    const { derived } = calculateForHousehold(
      household,
      [{ type: 'reduceWork', adultId: 'jane', daysPerFortnight: 8 }],
      { familyIncome: 200_000, children: { c1: { daysPerFortnight: 10, dailyFee: 175 } } },
    );
    expect(derived.engineInput.familyIncome).toBe(200_000);
    expect(derived.provenance.familyIncome.source).toBe('override');
    expect(derived.engineInput.children[0].daysPerFortnight).toBe(10);
    expect(derived.engineInput.children[0].dailyFee).toBe(175);
  });
});

describe('days per week, family support and the assumption note', () => {
  const household = (child: Partial<SbHousehold['children'][0]> = {}): SbHousehold => ({
    partnered: true,
    adults: [
      { id: 'mum', atiAnnual: 55_000, workDaysPerWeek: 3 },
      { id: 'dad', atiAnnual: 95_000, workDaysPerWeek: 5 },
    ],
    children: [{
      id: 'c1', ageYears: 3, inCare: true, careType: 'CBDC',
      dailyFee: 150, hoursPerDay: 10, ...child,
    }],
  });

  it('derives days needing care from the lesser-working parent', () => {
    const { derived } = calculateForHousehold(household());
    expect(derived.carePatterns.c1.careDaysPerWeek).toBe(3);
    expect(derived.engineInput.children[0].daysPerFortnight).toBe(6);
  });

  it('subtracts family support days from the days in paid care', () => {
    const { derived } = calculateForHousehold(household({ careDaysPerWeek: 3, familySupportDaysPerWeek: 1 }));
    expect(derived.carePatterns.c1.childcareDaysPerWeek).toBe(2);
    expect(derived.engineInput.children[0].daysPerFortnight).toBe(4);
  });

  it('never goes below zero days when family support exceeds the days needed', () => {
    const { derived } = calculateForHousehold(household({ careDaysPerWeek: 2, familySupportDaysPerWeek: 3 }));
    expect(derived.engineInput.children[0].daysPerFortnight).toBe(0);
    expect(derived.notes.join(' ')).toMatch(/exceeds the days needing care/);
  });

  it('lets hours per fortnight override the day figures for edge cases', () => {
    const { derived } = calculateForHousehold(household({ careDaysPerWeek: 3, hoursPerFortnight: 45 }));
    expect(derived.carePatterns.c1.basis).toBe('hours');
    expect(derived.engineInput.children[0].daysPerFortnight).toBe(4.5);
  });

  it('still accepts days per fortnight directly', () => {
    const { derived } = calculateForHousehold(household({ daysPerFortnight: 7 }));
    expect(derived.carePatterns.c1.basis).toBe('daysPerFortnight');
    expect(derived.engineInput.children[0].daysPerFortnight).toBe(7);
  });

  it('writes an assumption note naming the work, support and care split', () => {
    const { note } = calculateForHousehold(household({ careDaysPerWeek: 3, familySupportDaysPerWeek: 1 }));
    expect(note).toMatch(/you work 3 days a week/);
    expect(note).toMatch(/1 day of family support/);
    expect(note).toMatch(/2 days in child care/);
    expect(note).toMatch(/a fortnight/);
  });

  it('flags defaults in the note so the figure is not mistaken for a quote', () => {
    const h = household();
    delete (h.children[0] as { dailyFee?: number }).dailyFee;
    const { note } = calculateForHousehold(h);
    expect(note).toMatch(/the daily fee/);
    expect(note).toMatch(/default/);
  });
});

describe('In Home Care matches StartingBlocks', () => {
  const twoIhc: SbHousehold = {
    partnered: true,
    adults: [
      { id: 'a', atiAnnual: 60_000, workDaysPerWeek: 5 },
      { id: 'b', atiAnnual: 60_000, workDaysPerWeek: 5 },
    ],
    children: [
      { id: 'c1', ageYears: 0, inCare: true, careType: 'IHC', dailyFee: 200, hoursPerDay: 8, careDaysPerWeek: 5 },
      { id: 'c2', ageYears: 1, inCare: true, careType: 'IHC', dailyFee: 218, hoursPerDay: 9, careDaysPerWeek: 5 },
    ],
  };

  it('costs both In Home Care children and warns that the site models only one', () => {
    // StartingBlocks renders "-" for a second In Home Care child, so it cannot
    // be reconciled against. Costing both is the safer side to err on: dropping
    // one would understate a real family's fees.
    const { result } = calculateForHousehold(twoIhc);
    expect(result.children.map(c => c.id)).toEqual(['c1', 'c2']);
    expect(result.totals.perFortnight.fees).toBe(2000 + 2180);
    expect(result.warnings.join(' ')).toMatch(/In Home Care/i);
  });

  it('gives an In Home Care child the standard rate even as the younger sibling', () => {
    const { result } = calculateForHousehold({
      partnered: true,
      adults: [{ id: 'a', atiAnnual: 50_000, workDaysPerWeek: 5 }, { id: 'b', atiAnnual: 50_000, workDaysPerWeek: 5 }],
      children: [
        { id: 'elder', ageYears: 4, inCare: true, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, careDaysPerWeek: 5 },
        { id: 'younger', ageYears: 1, inCare: true, careType: 'IHC', dailyFee: 200, hoursPerDay: 10, careDaysPerWeek: 5 },
      ],
    });
    expect(result.children.find(c => c.id === 'younger')!.rateType).toBe('standard');
  });

  it('still counts an In Home Care child for birth order', () => {
    // IHC eldest under 6 takes the standard slot, so the CBDC sibling is second
    // and does get the higher rate.
    const { result } = calculateForHousehold({
      partnered: true,
      adults: [{ id: 'a', atiAnnual: 50_000, workDaysPerWeek: 5 }, { id: 'b', atiAnnual: 50_000, workDaysPerWeek: 5 }],
      children: [
        { id: 'ihc-elder', ageYears: 5, inCare: true, careType: 'IHC', dailyFee: 200, hoursPerDay: 10, careDaysPerWeek: 5 },
        { id: 'cbdc-younger', ageYears: 1, inCare: true, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, careDaysPerWeek: 5 },
      ],
    });
    expect(result.children.find(c => c.id === 'ihc-elder')!.rateType).toBe('standard');
    expect(result.children.find(c => c.id === 'cbdc-younger')!.rateType).toBe('higher');
  });
});
