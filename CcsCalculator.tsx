import { useMemo, useState } from 'react';
import { CareType, getRates } from './ccsRates';
import { ChildInput, FamilyInput, calculateCcs } from './ccsEngine';
import { DEFAULTS } from './strategyBuilderAdapter';

/**
 * Standalone CCS calculator. Same inputs as StartingBlocks.gov.au:
 * family income, participation, then per child: age, care type, fee,
 * hours per day, days. Renders subsidy and out-of-pocket per week,
 * fortnight and year.
 *
 * Props let the Strategy Builder pre-fill and lock fields; every field
 * remains overridable unless `locked` includes it.
 */

const CARE_LABELS: Record<CareType, string> = {
  CBDC: 'Centre based day care (long day care)',
  FDC: 'Family day care',
  OSHC: 'Outside school hours care',
  IHC: 'In home care',
};

const money = (n: number) => n.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });

export interface CcsCalculatorProps {
  initial?: Partial<FamilyInput>;
  locked?: Array<'familyIncome' | 'partnered' | 'participation'>;
  onChange?: (input: FamilyInput) => void;
}

function newChild(n: number): ChildInput {
  return {
    id: `child-${n}`,
    ageYears: 3,
    careType: DEFAULTS.careType,
    dailyFee: DEFAULTS.dailyFee.CBDC,
    hoursPerDay: DEFAULTS.hoursPerDay.CBDC,
    daysPerFortnight: DEFAULTS.daysPerFortnight,
  };
}

export default function CcsCalculator({ initial, locked = [], onChange }: CcsCalculatorProps) {
  const [input, setInput] = useState<FamilyInput>({
    partnered: true,
    familyIncome: 150_000,
    participationHours: { adult1: 76, adult2: 76 },
    applyWithholding: false,
    children: [newChild(1)],
    ...initial,
  });
  const rates = getRates(input.ccsYear);
  const result = useMemo(() => calculateCcs(input), [input]);

  const update = (patch: Partial<FamilyInput>) => {
    const next = { ...input, ...patch };
    setInput(next);
    onChange?.(next);
  };
  const updateChild = (id: string, patch: Partial<ChildInput>) =>
    update({ children: input.children.map(c => (c.id === id ? { ...c, ...patch } : c)) });

  const isLocked = (k: (typeof locked)[number]) => locked.includes(k);
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6 text-slate-800">
      <header>
        <h1 className="text-2xl font-semibold">Child Care Subsidy estimate</h1>
        <p className="mt-1 text-sm text-slate-600">
          CCS year {rates.ccsYear}, rates from {rates.effectiveFrom}. Estimate only; Services Australia determines entitlement.
        </p>
      </header>

      {/* Family */}
      <section className="space-y-4 rounded-lg border border-slate-200 p-5">
        <h2 className="font-medium">Your family</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Family situation
            <select
              className="rounded border border-slate-300 p-2"
              disabled={isLocked('partnered')}
              value={input.partnered ? 'partnered' : 'single'}
              onChange={e => update({ partnered: e.target.value === 'partnered' })}
            >
              <option value="single">Single</option>
              <option value="partnered">Partnered</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Combined family income (per year)
            <input
              type="number" min={0} step={1000}
              className="rounded border border-slate-300 p-2"
              disabled={isLocked('familyIncome')}
              value={input.familyIncome}
              onChange={e => update({ familyIncome: num(e.target.value) })}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Your recognised activity (hours per fortnight)
            <input
              type="number" min={0}
              className="rounded border border-slate-300 p-2"
              disabled={isLocked('participation')}
              value={input.participationHours.adult1}
              onChange={e => update({ participationHours: { ...input.participationHours, adult1: num(e.target.value) } })}
            />
          </label>
          {input.partnered && (
            <label className="flex flex-col gap-1 text-sm">
              Partner's recognised activity (hours per fortnight)
              <input
                type="number" min={0}
                className="rounded border border-slate-300 p-2"
                disabled={isLocked('participation')}
                value={input.participationHours.adult2 ?? 0}
                onChange={e => update({ participationHours: { ...input.participationHours, adult2: num(e.target.value) } })}
              />
            </label>
          )}
        </div>
        <p className="text-sm text-slate-600">
          Subsidised hours: <strong>{result.entitledHoursPerFortnight} per fortnight</strong> (72 for everyone under the 3 Day Guarantee; 100 if both adults do more than 48 hours of recognised activity a fortnight).
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!input.applyWithholding} onChange={e => update({ applyWithholding: e.target.checked })} />
          Show amounts after the 5% withheld until end-of-year balancing
        </label>
      </section>

      {/* Children */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Children in care</h2>
          <button
            type="button"
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white"
            onClick={() => update({ children: [...input.children, newChild(input.children.length + 1)] })}
          >
            Add a child
          </button>
        </div>
        {input.children.map((c, i) => {
          const cr = result.children.find(x => x.id === c.id)!;
          return (
            <div key={c.id} className="space-y-3 rounded-lg border border-slate-200 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Child {i + 1}</h3>
                {input.children.length > 1 && (
                  <button type="button" className="text-sm text-slate-500 underline" onClick={() => update({ children: input.children.filter(x => x.id !== c.id) })}>
                    Remove
                  </button>
                )}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1 text-sm">
                  Age (years)
                  <input type="number" min={0} max={17} className="rounded border border-slate-300 p-2" value={c.ageYears}
                    onChange={e => updateChild(c.id, { ageYears: num(e.target.value), schoolAge: undefined })} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Type of care
                  <select className="rounded border border-slate-300 p-2" value={c.careType}
                    onChange={e => {
                      const ct = e.target.value as CareType;
                      updateChild(c.id, { careType: ct, hoursPerDay: DEFAULTS.hoursPerDay[ct], dailyFee: DEFAULTS.dailyFee[ct] });
                    }}>
                    {(Object.keys(CARE_LABELS) as CareType[]).map(k => <option key={k} value={k}>{CARE_LABELS[k]}</option>)}
                  </select>
                </label>
                <label className="flex items-end gap-2 pb-2 text-sm">
                  <input type="checkbox" checked={c.schoolAge ?? c.ageYears >= 6} onChange={e => updateChild(c.id, { schoolAge: e.target.checked })} />
                  Attends school
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Daily fee ($)
                  <input type="number" min={0} step={1} className="rounded border border-slate-300 p-2" value={c.dailyFee ?? 0}
                    onChange={e => updateChild(c.id, { dailyFee: num(e.target.value), hourlyFee: undefined })} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Hours per day (session length)
                  <input type="number" min={1} max={24} step={0.5} className="rounded border border-slate-300 p-2" value={c.hoursPerDay}
                    onChange={e => updateChild(c.id, { hoursPerDay: num(e.target.value) })} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Days per fortnight
                  <input type="number" min={0} max={10} className="rounded border border-slate-300 p-2" value={c.daysPerFortnight}
                    onChange={e => updateChild(c.id, { daysPerFortnight: num(e.target.value) })} />
                </label>
              </div>
              <p className="text-sm text-slate-600">
                {cr.rateType === 'higher' ? 'Higher rate' : 'Standard rate'} {cr.ccsPercent}% of {money(cr.cappedHourlyFee)}/hr
                {cr.hourlyFee > cr.hourlyCap ? ` (fee ${money(cr.hourlyFee)}/hr is above the ${money(cr.hourlyCap)} cap)` : ''} ·
                {' '}{cr.subsidisedHoursPerFortnight} of {cr.hoursPerFortnight} hours subsidised ·
                {' '}out of pocket {money(cr.outOfPocketPerFortnight)} a fortnight
              </p>
            </div>
          );
        })}
      </section>

      {/* Results */}
      <section className="rounded-lg bg-slate-50 p-5">
        <h2 className="font-medium">Estimated cost</h2>
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-normal"></th>
              <th className="py-1 font-normal">Weekly</th>
              <th className="py-1 font-normal">Fortnightly</th>
              <th className="py-1 font-normal">Yearly</th>
            </tr>
          </thead>
          <tbody>
            {([
              ['Child care fees', 'fees'],
              ['Child Care Subsidy', input.applyWithholding ? 'paidSubsidy' : 'subsidy'],
              ['You pay', 'outOfPocket'],
            ] as const).map(([label, key]) => (
              <tr key={key} className={key === 'outOfPocket' ? 'font-semibold' : ''}>
                <td className="py-1">{label}</td>
                <td className="py-1">{money(result.totals.perWeek[key])}</td>
                <td className="py-1">{money(result.totals.perFortnight[key])}</td>
                <td className="py-1">{money(result.totals.perYear[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.warnings.map(w => <p key={w} className="mt-2 text-xs text-amber-700">{w}</p>)}
      </section>
    </div>
  );
}
