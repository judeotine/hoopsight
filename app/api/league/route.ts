import { NextResponse } from "next/server";
import { buildLeagueModel } from "@/lib/analytics";

export async function GET() {
  try {
    const league = await buildLeagueModel();
    const teams = Object.values(league.teams).sort((a, b) => b.srs - a.srs);
    return NextResponse.json({ teams, leagueAvg: league.leagueAvg, builtAt: league.builtAt });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
