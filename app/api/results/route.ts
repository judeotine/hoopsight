import { NextResponse } from "next/server";
import { buildLeagueModel } from "@/lib/analytics";
import { cached } from "@/lib/cache";
import { getSchedule } from "@/lib/espn";

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

const HOME_ADVANTAGE = 2.8;

export async function GET() {
  try {
    const result = await cached("recent_results", 30 * 60_000, async () => {
      const league = await buildLeagueModel();
      const teams = Object.values(league.teams);

      const cutoff = Date.now() - 36 * 3600_000;
      const seen = new Set<string>();
      const rows = [];

      for (const t of teams) {
        const sched = await getSchedule(t.id);
        for (const g of sched) {
          if (!g.completed || seen.has(g.gameId)) continue;
          if (new Date(g.date).getTime() < cutoff) continue;
          seen.add(g.gameId);

          const home = league.teams[g.homeId];
          const away = league.teams[g.awayId];
          if (!home || !away) continue;

          const margin = home.srs - away.srs + HOME_ADVANTAGE + 0.25 * (home.formNet - away.formNet);
          const modelHomeProb = sigmoid(margin * 0.145);
          const pickedHomeTeam = modelHomeProb >= 0.5;
          const homeWon = g.homeScore > g.awayScore;

          rows.push({
            gameId: g.gameId,
            date: g.date,
            home: { id: home.id, abbreviation: home.abbreviation, name: home.displayName, logo: home.logo, record: `${home.wins}-${home.losses}` },
            away: { id: away.id, abbreviation: away.abbreviation, name: away.displayName, logo: away.logo, record: `${away.wins}-${away.losses}` },
            homeScore: g.homeScore,
            awayScore: g.awayScore,
            winnerAbbr: homeWon ? home.abbreviation : away.abbreviation,
            modelHomeProb,
            modelPickAbbr: pickedHomeTeam ? home.abbreviation : away.abbreviation,
            modelPickProb: Math.max(modelHomeProb, 1 - modelHomeProb),
            correct: pickedHomeTeam === homeWon,
          });
        }
      }

      rows.sort((a, b) => b.date.localeCompare(a.date));
      const correct = rows.filter((r) => r.correct).length;

      return { games: rows, correct, total: rows.length, builtAt: new Date().toISOString() };
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
