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
  /**
   * Paid work pattern, days per FORTNIGHT (10 = full time).
   * Advisers usually talk in days per week — set `workDaysPerWeek` instead and
   * leave this undefined; whichever is given wins, and `workDaysPerWeek` wins
   * if both are.
   */
  workDaysPerFortnight?: number;
  /** Paid work pattern, days per WEEK (5 = full time). The usual way to enter this. */
  workDaysPerWeek?: number;
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
  /**
   * Days per WEEK the child needs care — normally the days the primary carer
   * works. Leave undefined to derive it from the work pattern (see
   * `deriveCareDaysPerWeek`).
   */
  careDaysPerWeek?: number;
  /**
   * Days per WEEK covered by family — grandparents, an aunt, a non-working
   * partner's day off. Subtracted from `careDaysPerWeek` to give the days
   * actually spent in paid care. Free, so it reduces fees and subsidy alike.
   */
  familySupportDaysPerWeek?: number;
  /** Days per FORTNIGHT in paid care. Escape hatch: overrides the weekly figures above. */
  daysPerFortnight?: number;
  hoursPerDay?: number;
  /**
   * Hours per FORTNIGHT in paid care. Second escape hatch, for the edge cases
   * that do not divide into whole days — a long day here, a half day there.
   * Beats every day-based figure; `hoursPerDay` still sets the session length.
   */
  hoursPerFortnight?: number;
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
  | { type: 'reduceWork'; adultId: string; daysPerFortnight?: number; daysPerWeek?: number; /** default: scale ATI pro rata */ newAtiAnnual?: number }
  | { type: 'increaseWork'; adultId: string; daysPerFortnight?: number; daysPerWeek?: number; newAtiAnnual?: number }
  | { type: 'incomeChange'; adultId: string; newAtiAnnual: number }
  | { type: 'childStartsCare'; child: SbChild }
  | { type: 'childLeavesCare'; childId: string }
  | { type: 'changeCareDays'; childId: string; daysPerFortnight?: number; daysPerWeek?: number }
  | { type: 'changeFamilySupport'; childId: string; daysPerWeek: number };

/** Adviser overrides — anything here beats derived values and defaults */
export interface CcsOverrides {
  familyIncome?: number;
  participationHours?: { adult1?: number; adult2?: number | null };
  participationExempt?: boolean;
  applyWithholding?: boolean;
  children?: Record<string, Partial<Pick<ChildInput, 'careType' | 'dailyFee' | 'hourlyFee' | 'hoursPerDay' | 'daysPerFortnight' | 'schoolAge' | 'firstNations'>>
    & { careDaysPerWeek?: number; familySupportDaysPerWeek?: number; hoursPerFortnight?: number }>;
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

// ---------- Weeks, fortnights and who is minding the child ----------

/**
 * Work days a fortnight for an adult, however the household recorded them.
 * `workDaysPerWeek` is the field advisers actually fill in; the fortnightly one
 * is kept for callers that already hold it.
 */
export function workDaysPerFortnightOf(a: Pick<SbAdult, 'workDaysPerWeek' | 'workDaysPerFortnight'>): number {
  if (a.workDaysPerWeek != null) return a.workDaysPerWeek * 2;
  return a.workDaysPerFortnight ?? 0;
}

/**
 * Days a week the child needs minding, when the household has not said.
 *
 * Care is needed on the days no parent is home. For a couple that is the days
 * the LESSER-working parent works — the other is at work on all of them. For a
 * single parent it is simply their work days.
 *
 * A guess, and flagged as a default in provenance so the adviser sees that.
 */
export function deriveCareDaysPerWeek(h: SbHousehold): number {
  const days = h.adults.map(a => workDaysPerFortnightOf(a) / 2);
  if (days.length === 0) return 0;
  return h.partnered && days.length > 1 ? Math.min(...days) : days[0];
}

/** What the child's week actually looks like once family help is counted. */
export interface CarePattern {
  careDaysPerWeek: number;          // days needing minding
  familySupportDaysPerWeek: number; // of those, days family covers for free
  childcareDaysPerWeek: number;     // the rest — what is paid for and subsidised
  daysPerFortnight: number;         // childcareDaysPerWeek x 2, unless overridden
  /** Set when an escape hatch was used, so the note can say so plainly. */
  basis: 'days' | 'daysPerFortnight' | 'hours';
}

// ---------- Provenance ----------

export type Source = 'household' | 'default' | 'override' | 'lifeEvent';
export interface Sourced<T> { value: T; source: Source }

export interface DerivedInputs {
  engineInput: FamilyInput;
  provenance: {
    familyIncome: Sourced<number>;
    participationHours: { adult1: Sourced<number>; adult2: Sourced<number | null> };
    children: Record<string, {
      hoursPerDay: Sourced<number>;
      dailyFee: Sourced<number>;
      daysPerFortnight: Sourced<number>;
      careType: Sourced<CareType>;
      careDaysPerWeek: Sourced<number>;
      familySupportDaysPerWeek: Sourced<number>;
    }>;
  };
  /** Per child, how the week was split. Feeds the assumption note. */
  carePatterns: Record<string, CarePattern>;
  /** Anything the adviser should see before quoting the number. */
  notes: string[];
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
        const before = workDaysPerFortnightOf(a);
        const after = e.daysPerWeek != null ? e.daysPerWeek * 2 : (e.daysPerFortnight ?? before);
        // Default: scale ATI pro rata with days. Adviser can pass newAtiAnnual instead.
        a.atiAnnual = e.newAtiAnnual ?? (before > 0 ? a.atiAnnual * (after / before) : a.atiAnnual);
        a.workDaysPerFortnight = after;
        a.workDaysPerWeek = after / 2;
        touched.add(`adult:${a.id}`);
        // Smart default: fewer work days means fewer days needing care. Only
        // pulls a child down, never up, and only where care days are explicit.
        if (e.type === 'reduceWork') {
          for (const c of household.children) {
            if (!c.inCare) continue;
            if (c.careDaysPerWeek != null && c.careDaysPerWeek > after / 2) {
              c.careDaysPerWeek = after / 2;
              touched.add(`child:${c.id}:days`);
            }
            if (c.daysPerFortnight != null && c.daysPerFortnight > after) {
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
        if (c) {
          if (e.daysPerWeek != null) { c.careDaysPerWeek = e.daysPerWeek; c.daysPerFortnight = undefined; }
          else if (e.daysPerFortnight != null) c.daysPerFortnight = e.daysPerFortnight;
          touched.add(`child:${c.id}:days`);
        }
        break;
      }
      case 'changeFamilySupport': {
        const c = household.children.find(x => x.id === e.childId);
        if (c) { c.familySupportDaysPerWeek = e.daysPerWeek; touched.add(`child:${c.id}:days`); }
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
    return workDaysPerFortnightOf(a) * (a.hoursPerWorkDay ?? DEFAULTS.hoursPerWorkDay) + (a.otherParticipationHoursPerFortnight ?? 0);
  };
  const p1: Sourced<number> =
    overrides.participationHours?.adult1 != null ? { value: overrides.participationHours.adult1, source: 'override' }
    : { value: partHours(a1) ?? 0, source: touched.has(`adult:${a1?.id}`) ? 'lifeEvent' : 'household' };
  const p2: Sourced<number | null> =
    overrides.participationHours?.adult2 !== undefined ? { value: overrides.participationHours.adult2 ?? null, source: 'override' }
    : { value: household.partnered ? partHours(a2) : null, source: touched.has(`adult:${a2?.id}`) ? 'lifeEvent' : 'household' };

  const childProv: DerivedInputs['provenance']['children'] = {};
  const carePatterns: Record<string, CarePattern> = {};
  const notes: string[] = [];
  const derivedCareDays = deriveCareDaysPerWeek(household);

  const children: ChildInput[] = household.children.filter(c => c.inCare).map(c => {
    const o = overrides.children?.[c.id] ?? {};
    const pick = <T,>(ov: T | undefined, hh: T | undefined, def: T, key?: string): Sourced<T> =>
      ov !== undefined ? { value: ov, source: 'override' }
      : hh !== undefined ? { value: hh, source: key && touched.has(key) ? 'lifeEvent' : 'household' }
      : { value: def, source: 'default' };

    const careType = pick<CareType>(o.careType, c.careType, DEFAULTS.careType);
    const hoursPerDay = pick(o.hoursPerDay, c.hoursPerDay, DEFAULTS.hoursPerDay[careType.value]);
    const dailyFee = pick(o.dailyFee, c.dailyFee, DEFAULTS.dailyFee[careType.value]);

    // How the week splits. Days per week is the normal path; days per
    // fortnight and hours per fortnight are escape hatches, in that order of
    // precedence, so a caller can always say exactly what it means.
    const careDays = pick(o.careDaysPerWeek, c.careDaysPerWeek, derivedCareDays, `child:${c.id}:days`);
    const support = pick(o.familySupportDaysPerWeek, c.familySupportDaysPerWeek, 0, `child:${c.id}:days`);
    const childcareDaysPerWeek = Math.max(0, careDays.value - support.value);

    const explicitFn = o.daysPerFortnight ?? c.daysPerFortnight;
    const explicitHours = o.hoursPerFortnight ?? c.hoursPerFortnight;

    let days: number;
    let basis: CarePattern['basis'];
    if (explicitHours != null) {
      days = hoursPerDay.value > 0 ? explicitHours / hoursPerDay.value : 0;
      basis = 'hours';
    } else if (explicitFn != null) {
      days = explicitFn;
      basis = 'daysPerFortnight';
    } else {
      days = childcareDaysPerWeek * 2;
      basis = 'days';
    }

    if (support.value > careDays.value) {
      notes.push(
        `Family support for ${c.id} (${support.value} days a week) exceeds the days needing care ` +
        `(${careDays.value}); no paid care has been assumed.`,
      );
    }

    // Where the final figure came from. An explicit fortnightly or hourly
    // figure is an override when the adviser set it, a life event when an event
    // moved it, and otherwise the household's own number.
    const explicitSource: Source =
      (o.daysPerFortnight ?? o.hoursPerFortnight) !== undefined ? 'override'
      : touched.has(`child:${c.id}:days`) ? 'lifeEvent'
      : 'household';
    const daysPerFortnight: Sourced<number> =
      basis === 'days'
        ? { value: days, source: careDays.source === 'default' && support.source === 'default' ? 'default' : careDays.source }
        : { value: days, source: explicitSource };

    carePatterns[c.id] = {
      careDaysPerWeek: careDays.value,
      familySupportDaysPerWeek: support.value,
      childcareDaysPerWeek: basis === 'days' ? childcareDaysPerWeek : days / 2,
      daysPerFortnight: days,
      basis,
    };
    childProv[c.id] = {
      careType, hoursPerDay, dailyFee, daysPerFortnight,
      careDaysPerWeek: careDays, familySupportDaysPerWeek: support,
    };
    return {
      id: c.id,
      ageYears: c.ageYears,
      schoolAge: o.schoolAge ?? c.schoolAge,
      careType: careType.value,
      dailyFee: o.hourlyFee != null ? undefined : dailyFee.value,
      hourlyFee: o.hourlyFee,
      hoursPerDay: hoursPerDay.value,
      daysPerFortnight: days,
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

  return {
    engineInput,
    provenance: { familyIncome, participationHours: { adult1: p1, adult2: p2 }, children: childProv },
    carePatterns,
    notes,
  };
}

// ---------- The assumption note ----------

const money = (n: number) =>
  `$${n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const days = (n: number) => {
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
  return `${v} day${n === 1 ? '' : 's'}`;
};

/**
 * One plain sentence saying what was assumed and what it costs, for the adviser
 * to put in front of the client.
 *
 *   "We have assumed you work 3 days a week, with 1 day of family support and
 *    2 days in child care. After subsidy that is $209.87 a fortnight."
 *
 * Written the way an adviser would say it out loud: what you told us, what we
 * filled in, and the number. Where a figure is a default rather than something
 * from the fact find it says so, because a number built on a guessed fee should
 * not read like a quote.
 */
export function buildAssumptionNote(derived: DerivedInputs, result: FamilyResult): string {
  const lines: string[] = [];
  // Only children the engine actually costed. A second In Home Care child is
  // dropped to match StartingBlocks, and describing care we did not charge for
  // would make the sentence a lie.
  const kids = result.children.map(c => c.id).filter(id => derived.carePatterns[id]);

  const work = derived.provenance.participationHours;
  const workDays = (hrs: number | null) =>
    hrs == null ? null : Math.round((hrs / DEFAULTS.hoursPerWorkDay / 2) * 10) / 10;
  const w1 = workDays(work.adult1.value);
  const w2 = workDays(work.adult2.value);

  const parts: string[] = [];
  if (w1 != null && w1 > 0) parts.push(`you work ${days(w1)} a week`);
  if (w2 != null && w2 > 0) parts.push(`your partner works ${days(w2)} a week`);

  for (const id of kids) {
    const p = derived.carePatterns[id];
    const who = kids.length > 1 ? id : 'your child';
    if (p.basis === 'hours') {
      const hpd = derived.engineInput.children.find(c => c.id === id)?.hoursPerDay ?? 0;
      parts.push(`${who} is in child care ${p.daysPerFortnight * hpd} hours a fortnight`);
      continue;
    }
    if (p.familySupportDaysPerWeek > 0) {
      parts.push(
        `${who} needs care ${days(p.careDaysPerWeek)} a week, with ` +
        `${days(p.familySupportDaysPerWeek)} of family support and ` +
        `${days(p.childcareDaysPerWeek)} in child care`,
      );
    } else {
      parts.push(`${who} is in child care ${days(p.childcareDaysPerWeek)} a week`);
    }
  }

  lines.push(
    `We have assumed ${parts.join(', ')}. After subsidy that is ` +
    `${money(result.totals.perFortnight.outOfPocket)} a fortnight ` +
    `(${money(result.totals.perYear.outOfPocket)} a year), with the government paying ` +
    `${money(result.totals.perFortnight.paidSubsidy)} a fortnight.`,
  );

  // Say which numbers were guesses, so the sentence above is not mistaken for a quote.
  const guessed = new Set<string>();
  for (const id of kids) {
    const pr = derived.provenance.children[id];
    if (pr.dailyFee.source === 'default') guessed.add('the daily fee');
    if (pr.hoursPerDay.source === 'default') guessed.add('the session length');
    // Only worth flagging when the care days were actually used. If the caller
    // gave hours or days per fortnight outright, the derived figure was ignored.
    if (pr.careDaysPerWeek.source === 'default' && derived.carePatterns[id].basis === 'days') {
      guessed.add('the days needing care');
    }
  }
  if (guessed.size) {
    const list = [...guessed];
    const joined = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}` : list[0];
    lines.push(
      list.length > 1
        ? `Note that ${joined} are defaults rather than figures from the fact find — confirm them before relying on this.`
        : `Note that ${joined} is a default rather than a figure from the fact find — confirm it before relying on this.`,
    );
  }

  for (const w of result.warnings) lines.push(w);
  for (const n of derived.notes) lines.push(n);

  return lines.join(' ');
}

/** One-call convenience: household + events + overrides → result */
export function calculateForHousehold(
  base: SbHousehold,
  lifeEvents: SbLifeEvent[] = [],
  overrides: CcsOverrides = {},
  ccsYear?: string,
): { result: FamilyResult; derived: DerivedInputs; note: string } {
  const derived = deriveCcsInputs(base, lifeEvents, overrides, ccsYear);
  const result = calculateCcs(derived.engineInput);
  return { result, derived, note: buildAssumptionNote(derived, result) };
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
