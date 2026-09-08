import { NextResponse } from "next/server";
import { getTeams } from "@/lib/espn";

export async function GET() {
  try {
    const teams = await getTeams();
    teams.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return NextResponse.json(teams);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
