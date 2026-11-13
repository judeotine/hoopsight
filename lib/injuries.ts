import { getInjuries, getTeamScoring, Injury } from "./espn";

export type InjuryImpact = {
  penalty: number;
  notes: string[];
};

export async function computeInjuryImpact(teamId: string, teamAbbr: string): Promise<InjuryImpact> {
  let injuries: Injury[] = [];
  let scoring: Record<string, number> = {};
  try {
    const all = await getInjuries();
    injuries = all[teamId] ?? [];
    scoring = await getTeamScoring(teamId);
  } catch {
    return { penalty: 0, notes: [] };
  }

  let penalty = 0;
  const notes: string[] = [];

  for (const inj of injuries) {
    const ppg = scoring[inj.athleteId];
    if (!ppg || ppg < 8) continue;

    const status = inj.status.toLowerCase();
    let weight = 0;
    if (status === "out") weight = 0.35;
    else if (status.includes("day")) weight = 0.12;
    if (!weight) continue;

    const hit = ppg * weight;
    penalty += hit;
    notes.push(`${inj.athlete} (${ppg.toFixed(1)} ppg) is ${inj.status}${status === "out" ? "" : ", partial weight applied"} costing ${teamAbbr} an estimated ${hit.toFixed(1)} points`);
  }

  return { penalty: Math.min(penalty, 7), notes };
}
