import { NextRequest, NextResponse } from "next/server";
import { buildLeagueModel } from "@/lib/analytics";
import { predictMatchup } from "@/lib/model";
import { getInjuries, getSchedule } from "@/lib/espn";
import { computeInjuryImpact } from "@/lib/injuries";
import { buildTeamPlayers } from "@/lib/lineup";
import { getOddsForMatchup } from "@/lib/odds";

export async function GET(req: NextRequest) {
  const homeId = req.nextUrl.searchParams.get("home");
  const awayId = req.nextUrl.searchParams.get("away");
  if (!homeId || !awayId || homeId === awayId) {
    return NextResponse.json({ error: "Pass distinct home and away team ids" }, { status: 400 });
  }
  try {
    const league = await buildLeagueModel();
    const home = league.teams[homeId];
    const away = league.teams[awayId];
    if (!home || !away) {
      return NextResponse.json({ error: "Unknown team id" }, { status: 404 });
    }

    const [homeImpact, awayImpact] = await Promise.all([
      computeInjuryImpact(homeId, home.abbreviation),
      computeInjuryImpact(awayId, away.abbreviation),
    ]);

    const prediction = predictMatchup(league, home, away, { home: homeImpact, away: awayImpact });

    const sched = await getSchedule(homeId);
    const h2h = sched
      .filter((g) => (g.homeId === awayId || g.awayId === awayId))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((g) => ({
        date: g.date,
        completed: g.completed,
        homeId: g.homeId,
        awayId: g.awayId,
        homeScore: g.completed ? g.homeScore : null,
        awayScore: g.completed ? g.awayScore : null,
      }));

    const injuries = await getInjuries().catch(() => ({} as Record<string, never[]>));
    const odds = await getOddsForMatchup(home.displayName, away.displayName, prediction.homeWinProb);
    const [homePlayers, awayPlayers] = await Promise.all([
      buildTeamPlayers(homeId),
      buildTeamPlayers(awayId),
    ]);

    return NextResponse.json({
      home,
      away,
      leagueAvg: league.leagueAvg,
      builtAt: league.builtAt,
      prediction,
      headToHead: h2h,
      injuries: { home: injuries[homeId] ?? [], away: injuries[awayId] ?? [] },
      players: { home: homePlayers, away: awayPlayers },
      odds,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
