/**
 * The hand-built edge cases (33 of them): income one dollar either side of every
 * threshold, fee below/at/above cap, participation 48 vs 49, single parent,
 * school-age OSHC, FDC, 12-hour sessions, three children.
 *
 * Shared by the live comparison and the offline baseline so both describe the
 * same cases.
 */
export function edgeCases() {
  const child = (o) => ({ id: 'child-1', ageYears: 3, careType: 'CBDC', dailyFee: 150, hoursPerDay: 10, daysPerFortnight: 6, ...o });
  const fam = (o) => ({ partnered: true, participationHours: { adult1: 76, adult2: 76 }, applyWithholding: false, ...o });
  const incomes = [0, 88519, 88520, 88521, 146436, 146437, 146438, 191436, 191437, 270726, 270727, 360726, 370725, 370726, 538519, 538520, 538521];
  const cases = [];
  for (const i of incomes) cases.push({ name: `edge income ${i} one child`, input: fam({ familyIncome: i, children: [child()] }) });
  // Two children under 6 is the only shape that exercises the HIGHER rate table,
  // so its thresholds have to be hit here and not in the one-child list above.
  // 370,726/370,727 is the one discontinuity in that table — the higher rate
  // stops and every child drops to the standard rate — and so the only boundary
  // in it a displayed figure can actually resolve. The original list jumped from
  // 365,000 to 371,000 and stepped straight over it.
  for (const i of [100000, 150000, 200000, 300000, 365000, 371000,
                   146436, 146437, 146438, 191436, 191437,
                   270725, 270726, 270727, 360725, 360726, 360727,
                   370725, 370726, 370727, 370728])
    cases.push({ name: `edge income ${i} two under 6`, input: fam({ familyIncome: i, children: [child({ id: 'child-1', ageYears: 4 }), child({ id: 'child-2', ageYears: 1 })] }) });
  cases.push({ name: 'edge fee below cap', input: fam({ familyIncome: 120000, children: [child({ dailyFee: 120 })] }) });
  cases.push({ name: 'edge fee at cap', input: fam({ familyIncome: 120000, children: [child({ dailyFee: 151.9 })] }) });
  cases.push({ name: 'edge fee above cap', input: fam({ familyIncome: 120000, children: [child({ dailyFee: 200 })] }) });
  cases.push({ name: 'edge participation 48 → 72 hrs', input: fam({ familyIncome: 120000, participationHours: { adult1: 76, adult2: 48 }, children: [child({ daysPerFortnight: 10 })] }) });
  cases.push({ name: 'edge participation 49 → 100 hrs', input: fam({ familyIncome: 120000, participationHours: { adult1: 76, adult2: 49 }, children: [child({ daysPerFortnight: 10 })] }) });
  cases.push({ name: 'edge single parent', input: fam({ partnered: false, participationHours: { adult1: 30, adult2: null }, familyIncome: 70000, children: [child()] }) });
  cases.push({ name: 'edge school-age OSHC', input: fam({ familyIncome: 120000, children: [child({ ageYears: 8, schoolAge: true, careType: 'OSHC', dailyFee: 30, hoursPerDay: 3, daysPerFortnight: 10 })] }) });
  cases.push({ name: 'edge FDC', input: fam({ familyIncome: 120000, children: [child({ careType: 'FDC', dailyFee: 130 })] }) });
  cases.push({ name: 'edge 12hr session over 100 hrs', input: fam({ familyIncome: 120000, children: [child({ hoursPerDay: 12, daysPerFortnight: 10 })] }) });
  cases.push({ name: 'edge three children mixed', input: fam({ familyIncome: 180000, children: [child({ ageYears: 7, schoolAge: true, careType: 'OSHC', dailyFee: 30, hoursPerDay: 3 }), child({ id: 'child-2', ageYears: 4 }), child({ id: 'child-3', ageYears: 1 })] }) });
  return cases;
}
