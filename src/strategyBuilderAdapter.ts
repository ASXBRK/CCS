/**
 * Adapter between the Strategy Builder's household model and the CCS engine.
 *
 * Responsibilities:
 *   - Derive engine inputs from household data already captured (partnered,
 *     incomes, work pattern, children).
 *   - Apply smart defaults (session length, fee) that the adviser can override.
 *   - Apply life events (e.g. "reduce work by 2 days a fortnight") to income,
 *     participation hours and — by default — days of care, then recalculate.
 *
 * Every derived value is returned with its source ('household' | 'default' |
 * 'override' | 'lifeEvent') so the UI can show where a number came from.
 */

import { CareType } from './ccsRates';
import { ChildInput, FamilyInput, FamilyResult, calculateCcs } from './ccsEngine';

// ---------- Strategy Builder side (shape it with your real types) ----------

export interface SbAdult {
  id: string;
  /** Adjusted taxable income for CCS purposes (taxable + RFB + net inv. loss + RESC etc.) */
  atiAnnual: number;
  /** Paid work pattern, days per fortnight (10 = full time) */
  workDaysPerFortnight: number;
  /** Paid hours per working day (default 7.6) */
  hoursPerWorkDay?: number;
  /** Other recognised participation hours per fortnight (study, volunteering, job search) */
  otherParticipationHoursPerFortnight?: number;
}

export interface SbChild {
  id: string;
  ageYears: number;
  schoolAge?: boolean;
  inCare: boolean;
  careType?: CareType;
  daysPerFortnight?: number;
  hoursPerDay?: number;
  dailyFee?: number;
  firstNations?: boolean;
}

export interface SbHousehold {
  partnered: boolean;
  adults: SbAdult[]; // 1 or 2
  children: SbChild[];
}

/** Life events the Strategy Builder can raise that affect CCS */
export type SbLifeEvent =
  | { type: 'reduceWork'; adultId: string; daysPerFortnight: number; /** default: scale ATI pro rata */ newAtiAnnual?: number }
  | { type: 'increaseWork'; adultId: string; daysPerFortnight: number; newAtiAnnual?: number }
  | { type: 'incomeChange'; adultId: string; newAtiAnnual: number }
  | { type: 'childStartsCare'; child: SbChild }
  | { type: 'childLeavesCare'; childId: string }
  | { type: 'changeCareDays'; childId: string; daysPerFortnight: number };

/** Adviser overrides — anything here beats derived values and defaults */
export interface CcsOverrides {
  familyIncome?: number;
  participationHours?: { adult1?: number; adult2?: number | null };
  participationExempt?: boolean;
  applyWithholding?: boolean;
  children?: Record<string, Partial<Pick<ChildInput, 'careType' | 'dailyFee' | 'hourlyFee' | 'hoursPerDay' | 'daysPerFortnight' | 'schoolAge' | 'firstNations'>>>;
}

// ---------- Smart defaults (mirror the StartingBlocks defaults) ----------

export const DEFAULTS = {
  hoursPerWorkDay: 7.6,
  /** Default session length by care type (hours). Align to StartingBlocks defaults during golden testing. */
  hoursPerDay: { CBDC: 10, FDC: 10, OSHC: 3, IHC: 10 } as Record<CareType, number>,
  /** Default daily fee by care type ($). Placeholder national figures — replace with Perth/firm data. */
  dailyFee: { CBDC: 150, FDC: 120, OSHC: 35, IHC: 400 } as Record<CareType, number>,
  careType: 'CBDC' as CareType,
  daysPerFortnight: 6,
  applyWithholding: false,
} as const;

// ---------- Provenance ----------

export type Source = 'household' | 'default' | 'override' | 'lifeEvent';
export interface Sourced<T> { value: T; source: Source }

export interface DerivedInputs {
  engineInput: FamilyInput;
  provenance: {
    familyIncome: Sourced<number>;
    participationHours: { adult1: Sourced<number>; adult2: Sourced<number | null> };
    children: Record<string, { hoursPerDay: Sourced<number>; dailyFee: Sourced<number>; daysPerFortnight: Sourced<number>; careType: Sourced<CareType> }>;
  };
}

// ---------- Life events ----------

function applyLifeEvents(h: SbHousehold, events: SbLifeEvent[]): { household: SbHousehold; touched: Set<string> } {
  const household: SbHousehold = JSON.parse(JSON.stringify(h));
  const touched = new Set<string>();

  for (const e of events) {
    switch (e.type) {
      case 'reduceWork':
      case 'increaseWork': {
        const a = household.adults.find(x => x.id === e.adultId);
        if (!a) break;
        const before = a.workDaysPerFortnight || 0;
        const after = e.daysPerFortnight;
        // Default: scale ATI pro rata with days. Adviser can pass newAtiAnnual instead.
        a.atiAnnual = e.newAtiAnnual ?? (before > 0 ? a.atiAnnual * (after / before) : a.atiAnnual);
        a.workDaysPerFortnight = after;
        touched.add(`adult:${a.id}`);
        // Smart default: if work days fall, care days fall to match the new work pattern
        // (per child, only if care days currently exceed the reduced work days).
        if (e.type === 'reduceWork') {
          for (const c of household.children) {
            if (c.inCare && (c.daysPerFortnight ?? DEFAULTS.daysPerFortnight) > after) {
              c.daysPerFortnight = after;
              touched.add(`child:${c.id}:days`);
            }
          }
        }
        break;
      }
      case 'incomeChange': {
        const a = household.adults.find(x => x.id === e.adultId);
        if (a) { a.atiAnnual = e.newAtiAnnual; touched.add(`adult:${a.id}`); }
        break;
      }
      case 'childStartsCare':
        household.children = household.children.filter(c => c.id !== e.child.id).concat({ ...e.child, inCare: true });
        touched.add(`child:${e.child.id}`);
        break;
      case 'childLeavesCare': {
        const c = household.children.find(x => x.id === e.childId);
        if (c) { c.inCare = false; touched.add(`child:${c.id}`); }
        break;
      }
      case 'changeCareDays': {
        const c = household.children.find(x => x.id === e.childId);
        if (c) { c.daysPerFortnight = e.daysPerFortnight; touched.add(`child:${c.id}:days`); }
        break;
      }
    }
  }
  return { household, touched };
}

// ---------- Derivation ----------

export function deriveCcsInputs(
  base: SbHousehold,
  lifeEvents: SbLifeEvent[] = [],
  overrides: CcsOverrides = {},
  ccsYear?: string,
): DerivedInputs {
  const { household, touched } = applyLifeEvents(base, lifeEvents);
  const [a1, a2] = household.adults;

  const incomeDerived = household.adults.reduce((t, a) => t + (a.atiAnnual || 0), 0);
  const familyIncome: Sourced<number> =
    overrides.familyIncome != null ? { value: overrides.familyIncome, source: 'override' }
    : { value: incomeDerived, source: touched.size ? 'lifeEvent' : 'household' };

  const partHours = (a?: SbAdult): number | null => {
    if (!a) return null;
    return a.workDaysPerFortnight * (a.hoursPerWorkDay ?? DEFAULTS.hoursPerWorkDay) + (a.otherParticipationHoursPerFortnight ?? 0);
  };
  const p1: Sourced<number> =
    overrides.participationHours?.adult1 != null ? { value: overrides.participationHours.adult1, source: 'override' }
    : { value: partHours(a1) ?? 0, source: touched.has(`adult:${a1?.id}`) ? 'lifeEvent' : 'household' };
  const p2: Sourced<number | null> =
    overrides.participationHours?.adult2 !== undefined ? { value: overrides.participationHours.adult2 ?? null, source: 'override' }
    : { value: household.partnered ? partHours(a2) : null, source: touched.has(`adult:${a2?.id}`) ? 'lifeEvent' : 'household' };

  const childProv: DerivedInputs['provenance']['children'] = {};
  const children: ChildInput[] = household.children.filter(c => c.inCare).map(c => {
    const o = overrides.children?.[c.id] ?? {};
    const pick = <T,>(ov: T | undefined, hh: T | undefined, def: T, key?: string): Sourced<T> =>
      ov !== undefined ? { value: ov, source: 'override' }
      : hh !== undefined ? { value: hh, source: key && touched.has(key) ? 'lifeEvent' : 'household' }
      : { value: def, source: 'default' };

    const careType = pick<CareType>(o.careType, c.careType, DEFAULTS.careType);
    const hoursPerDay = pick(o.hoursPerDay, c.hoursPerDay, DEFAULTS.hoursPerDay[careType.value]);
    const dailyFee = pick(o.dailyFee, c.dailyFee, DEFAULTS.dailyFee[careType.value]);
    const daysPerFortnight = pick(o.daysPerFortnight, c.daysPerFortnight, DEFAULTS.daysPerFortnight, `child:${c.id}:days`);

    childProv[c.id] = { careType, hoursPerDay, dailyFee, daysPerFortnight };
    return {
      id: c.id,
      ageYears: c.ageYears,
      schoolAge: o.schoolAge ?? c.schoolAge,
      careType: careType.value,
      dailyFee: o.hourlyFee != null ? undefined : dailyFee.value,
      hourlyFee: o.hourlyFee,
      hoursPerDay: hoursPerDay.value,
      daysPerFortnight: daysPerFortnight.value,
      firstNations: o.firstNations ?? c.firstNations,
    };
  });

  const engineInput: FamilyInput = {
    ccsYear,
    partnered: household.partnered,
    familyIncome: familyIncome.value,
    participationHours: { adult1: p1.value, adult2: p2.value },
    participationExempt: overrides.participationExempt,
    applyWithholding: overrides.applyWithholding ?? DEFAULTS.applyWithholding,
    children,
  };

  return { engineInput, provenance: { familyIncome, participationHours: { adult1: p1, adult2: p2 }, children: childProv } };
}

/** One-call convenience: household + events + overrides → result */
export function calculateForHousehold(
  base: SbHousehold,
  lifeEvents: SbLifeEvent[] = [],
  overrides: CcsOverrides = {},
  ccsYear?: string,
): { result: FamilyResult; derived: DerivedInputs } {
  const derived = deriveCcsInputs(base, lifeEvents, overrides, ccsYear);
  return { result: calculateCcs(derived.engineInput), derived };
}

/** Before/after comparison for a life event (what the strategy builder will show) */
export function compareLifeEvent(base: SbHousehold, lifeEvents: SbLifeEvent[], overrides: CcsOverrides = {}) {
  const before = calculateForHousehold(base, [], overrides);
  const after = calculateForHousehold(base, lifeEvents, overrides);
  const d = (k: keyof FamilyResult['totals']['perYear']) => after.result.totals.perYear[k] - before.result.totals.perYear[k];
  return {
    before, after,
    deltaPerYear: { fees: d('fees'), subsidy: d('subsidy'), outOfPocket: d('outOfPocket') },
  };
}
