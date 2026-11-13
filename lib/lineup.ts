import { getInjuries, getTeamLeaders, getTeamRoster } from "./espn";

export type LineupPlayer = {
  id: string;
  name: string;
  position: string;
  jersey: string;
  headshot: string;
  ppg: number;
  rpg: number;
  apg: number;
  mpg: number;
  status: string;
};

export type TeamPlayers = {
  lineup: LineupPlayer[];
  bench: LineupPlayer[];
  out: LineupPlayer[];
};

export async function buildTeamPlayers(teamId: string): Promise<TeamPlayers> {
  try {
    const [roster, leaders, injuries] = await Promise.all([
      getTeamRoster(teamId),
      getTeamLeaders(teamId),
      getInjuries().catch(() => ({} as Record<string, { athleteId: string; status: string }[]>)),
    ]);

    const statusById: Record<string, string> = {};
    for (const inj of injuries[teamId] ?? []) {
      statusById[inj.athleteId] = inj.status;
    }

    const players: LineupPlayer[] = roster
      .map((p) => ({
        ...p,
        ppg: leaders[p.id]?.ppg ?? 0,
        rpg: leaders[p.id]?.rpg ?? 0,
        apg: leaders[p.id]?.apg ?? 0,
        mpg: leaders[p.id]?.mpg ?? 0,
        status: statusById[p.id] ?? "Active",
      }))
      .sort((a, b) => b.mpg - a.mpg);

    const available = players.filter((p) => p.status.toLowerCase() !== "out");
    const out = players.filter((p) => p.status.toLowerCase() === "out" && p.mpg > 0);
    const lineup = available.slice(0, 5);
    const bench = available.slice(5, 11).filter((p) => p.mpg > 0);

    return { lineup, bench, out };
  } catch {
    return { lineup: [], bench: [], out: [] };
  }
}
