import { NextRequest, NextResponse } from "next/server";
import { betStats, readBets, writeBets } from "@/lib/bets";
import { autoSettleBets } from "@/lib/settle";

export async function GET() {
  try {
    await autoSettleBets();
  } catch {}
  const bets = readBets().sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  return NextResponse.json({ bets, stats: betStats(bets) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const bets = readBets().filter((b) => b.id !== id);
  writeBets(bets);
  return NextResponse.json({ ok: true, stats: betStats(bets) });
}
