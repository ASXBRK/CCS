import { describe, it, expect } from 'vitest';
import { calculateCcs, standardPercent, higherPercent, entitledHours } from '../src/ccsEngine';
import { getRates, standardUpperThreshold } from '../src/ccsRates';

const r = getRates('2026-27');

describe('standard percentage table (2026-27)', () => {
  it('is 90% at and below the lower threshold', () => {
    expect(standardPercent(0, r)).toBe(90);
    expect(standardPercent(88_520, r)).toBe(90);
  });
  it('tapers 1% per $5,000', () => {
    expect(standardPercent(93_520, r)).toBe(89);
    expect(standardPercent(150_000, r)).toBe(77.7);
    expect(standardPercent(200_000, r)).toBe(67.7);
  });
  it('is nil at the upper threshold', () => {
    expect(standardUpperThreshold(r)).toBe(538_520);
    expect(standardPercent(538_520, r)).toBe(0);
    expect(standardPercent(538_519, r)).toBeCloseTo(0, 2);
  });
});

describe('higher percentage table (2026-27)', () => {
  it('95% up to t1, tapers to 80%, plateaus, tapers to 50%, plateaus, reverts', () => {
    expect(higherPercent(100_000, r)).toBe(95);
    expect(higherPercent(146_437, r)).toBe(95);
    expect(higherPercent(161_437, r)).toBe(90);
    expect(higherPercent(191_437, r)).toBe(80);
    expect(higherPercent(270_726, r)).toBe(80);
    expect(higherPercent(300_726, r)).toBe(70);
    expect(higherPercent(360_726, r)).toBe(50);
    expect(higherPercent(370_725, r)).toBe(50);
    expect(higherPercent(370_726, r)).toBe(50);   // last dollar that still gets it
    expect(higherPercent(370_727, r)).toBeNull(); // Services Australia: "income below $370,727"
  });
});

describe('subsidised hours under the 3 Day Guarantee', () => {
  it('72 baseline, 100 when both adults exceed 48 hours', () => {
    const base = { partnered: true, familyIncome: 0, children: [] };
    expect(entitledHours({ ...base, participationHours: { adult1: 0, adult2: 0 } }, r)).toBe(72);
    expect(entitledHours({ ...base, participationHours: { adult1: 76, adult2: 48 } }, r)).toBe(72);
    expect(entitledHours({ ...base, participationHours: { adult1: 76, adult2: 49 } }, r)).toBe(100);
    expect(entitledHours({ ...base, partnered: false, participationHours: { adult1: 60 } }, r)).toBe(100);
    expect(entitledHours({ ...base, participationHours: { adult1: 0, adult2: 0 }, participationExempt: true }, r)).toBe(100);
  });
});

describe('end-to-end calculation', () => {
  it('one child, fee above cap, full hours', () => {
    const res = calculateCcs({
      partnered: true, familyIncome: 150_000,
      participationHours: { adult1: 76, adult2: 76 },
      children: [{ id: 'a', ageYears: 3, careType: 'CBDC', dailyFee: 160, hoursPerDay: 10, daysPerFortnight: 10 }],
    });
    const c = res.children[0];
    expect(c.ccsPercent).toBe(77.7);
    expect(c.hourlyFee).toBe(16);
    expect(c.cappedHourlyFee).toBe(15.19);
    expect(c.hourlySubsidy).toBe(11.80);
    expect(c.subsidisedHoursPerFortnight).toBe(100);
    expect(c.feePerFortnight).toBe(1600);
    // 11.80 × 100, not 11.8026 × 100: the per-hour subsidy is a cents figure
    // before it is multiplied by hours, as on StartingBlocks.
    expect(c.subsidyPerFortnight).toBe(1180);
    expect(c.outOfPocketPerFortnight).toBe(420);
    expect(res.totals.perWeek.outOfPocket).toBe(210);
    expect(res.totals.perYear.outOfPocket).toBe(10920);
  });

  it('the displayed hourly subsidy times the hours is the displayed subsidy', () => {
    const res = calculateCcs({
      partnered: true, familyIncome: 120_000, participationHours: { adult1: 76, adult2: 76 },
      children: [{ id: 'a', ageYears: 3, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 }],
    });
    const c = res.children[0];
    expect(c.ccsPercent).toBe(83.7);
    expect(c.hourlySubsidy).toBe(12.56);     // 0.8370 × 15.00 = 12.555 → 12.56
    expect(c.subsidyPerFortnight).toBe(753.6); // 12.56 × 60, matches StartingBlocks
  });

  it('half-cent ties resolve as Services Australia resolves them', () => {
    const child = { id: 'a', ageYears: 3, careType: 'CBDC' as const, dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 };
    const at = (familyIncome: number) =>
      calculateCcs({ partnered: true, familyIncome, participationHours: { adult1: 76, adult2: 76 }, children: [child] }).children[0];
    expect(at(300_000).ccsPercent).toBe(47.7);
    expect(at(300_000).hourlySubsidy).toBe(7.15);   // 47.70% × $15.00 = 7.155 → 7.15 on the live tool
    expect(at(280_000).ccsPercent).toBe(51.7);
    expect(at(280_000).hourlySubsidy).toBe(7.76);   // 51.70% × $15.00 = 7.755 → 7.76 on the live tool
  });

  it('hours above entitlement are unsubsidised', () => {
    const res = calculateCcs({
      partnered: false, familyIncome: 60_000, participationHours: { adult1: 20 },
      children: [{ id: 'a', ageYears: 2, careType: 'CBDC', dailyFee: 120, hoursPerDay: 12, daysPerFortnight: 10 }],
    });
    const c = res.children[0];
    expect(c.hoursPerFortnight).toBe(120);
    expect(c.subsidisedHoursPerFortnight).toBe(72);
    expect(c.unsubsidisedHoursPerFortnight).toBe(48);
    expect(c.subsidyPerFortnight).toBe(648);
    expect(c.outOfPocketPerFortnight).toBe(552);
  });

  it('second child under 6 gets the higher rate; eldest is standard', () => {
    const res = calculateCcs({
      partnered: true, familyIncome: 150_000, participationHours: { adult1: 76, adult2: 76 },
      children: [
        { id: 'young', ageYears: 1, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
        { id: 'old', ageYears: 4, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
      ],
    });
    const byId = Object.fromEntries(res.children.map(c => [c.id, c]));
    expect(byId.old.rateType).toBe('standard');
    expect(byId.old.ccsPercent).toBe(77.7);
    expect(byId.young.rateType).toBe('higher');
    expect(byId.young.ccsPercent).toBe(93.81); // 95 − (150,000−146,437)/3,000 = 93.8123
  });

  it('school-age child never counts toward the higher rate and uses the school-age cap', () => {
    const res = calculateCcs({
      partnered: true, familyIncome: 100_000, participationHours: { adult1: 76, adult2: 76 },
      children: [
        { id: 'school', ageYears: 7, careType: 'OSHC', dailyFee: 30, hoursPerDay: 3, daysPerFortnight: 10 },
        { id: 'kid', ageYears: 3, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
      ],
    });
    const byId = Object.fromEntries(res.children.map(c => [c.id, c]));
    expect(byId.school.rateType).toBe('standard');
    expect(byId.school.hourlyCap).toBe(13.30);
    expect(byId.kid.rateType).toBe('standard');
    expect(res.higherPercent).toBeNull();
  });

  it('an In Home Care child is always on the standard rate but still counts toward the test', () => {
    const fam = (children: Parameters<typeof calculateCcs>[0]['children']) =>
      calculateCcs({ partnered: true, familyIncome: 150_000, participationHours: { adult1: 76, adult2: 76 }, children });
    const child = (id: string, ageYears: number, careType: 'CBDC' | 'IHC') =>
      ({ id, ageYears, careType, dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 });

    // IHC second child: the family qualifies, the CBDC eldest is standard, and
    // the IHC child is standard too rather than 93.81%.
    let byId = Object.fromEntries(fam([child('old', 4, 'CBDC'), child('young', 1, 'IHC')]).children.map(c => [c.id, c]));
    expect(byId.old.rateType).toBe('standard');
    expect(byId.young.rateType).toBe('standard');
    expect(byId.young.ccsPercent).toBe(77.7);

    // IHC eldest: it is still the standard-rate child, so the CBDC younger
    // child gets the higher rate.
    byId = Object.fromEntries(fam([child('old', 4, 'IHC'), child('young', 1, 'CBDC')]).children.map(c => [c.id, c]));
    expect(byId.old.rateType).toBe('standard');
    expect(byId.young.rateType).toBe('higher');
    expect(byId.young.ccsPercent).toBe(93.81);
  });

  it('two under-sixes of the same age: the first listed is the standard-rate child', () => {
    const res = calculateCcs({
      partnered: true, familyIncome: 150_000, participationHours: { adult1: 76, adult2: 76 },
      children: [
        { id: 'first', ageYears: 4, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
        { id: 'second', ageYears: 4, careType: 'FDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
      ],
    });
    const byId = Object.fromEntries(res.children.map(c => [c.id, c]));
    expect(byId.first.rateType).toBe('standard');
    expect(byId.second.rateType).toBe('higher');
  });

  it('higher rate survives at $370,726 and reverts to standard from $370,727', () => {
    const kids = [
      { id: 'a', ageYears: 1, careType: 'CBDC' as const, dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
      { id: 'b', ageYears: 4, careType: 'CBDC' as const, dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
    ];
    const at = (familyIncome: number) =>
      calculateCcs({ partnered: true, familyIncome, participationHours: { adult1: 76, adult2: 76 }, children: kids });
    expect(at(370_726).children.find(c => c.id === 'a')!.rateType).toBe('higher');
    expect(at(370_726).children.find(c => c.id === 'a')!.ccsPercent).toBe(50);
    expect(at(370_727).children.every(c => c.rateType === 'standard')).toBe(true);
  });

  it('higher rate reverts to standard well above the limit', () => {
    const res = calculateCcs({
      partnered: true, familyIncome: 380_000, participationHours: { adult1: 76, adult2: 76 },
      children: [
        { id: 'a', ageYears: 1, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
        { id: 'b', ageYears: 4, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6 },
      ],
    });
    expect(res.children.every(c => c.rateType === 'standard')).toBe(true);
    expect(res.children[0].ccsPercent).toBe(31.7);
  });

  it('withholding reduces the paid subsidy by 5%', () => {
    const res = calculateCcs({
      partnered: true, familyIncome: 80_000, participationHours: { adult1: 76, adult2: 76 }, applyWithholding: true,
      children: [{ id: 'a', ageYears: 3, careType: 'FDC', hourlyFee: 12, hoursPerDay: 10, daysPerFortnight: 10 }],
    });
    const c = res.children[0];
    expect(c.subsidyPerFortnight).toBe(1080);
    expect(c.withheldPerFortnight).toBe(54);
    expect(c.paidSubsidyPerFortnight).toBe(1026);
    expect(c.outOfPocketPerFortnight).toBe(174);
  });
});
