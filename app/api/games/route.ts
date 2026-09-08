import { NextResponse } from "next/server";
import { getUpcomingGames } from "@/lib/espn";

export async function GET() {
  try {
    const games = await getUpcomingGames(3);
    return NextResponse.json(games);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
