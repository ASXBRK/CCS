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
