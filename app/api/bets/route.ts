import { NextRequest, NextResponse } from "next/server";
import { Bet, betStats, readBets, writeBets } from "@/lib/bets";

export async function GET() {
  const bets = readBets().sort((a, b) => b.placedAt.localeCompare(a.placedAt));
  return NextResponse.json({ bets, stats: betStats(bets) });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { game, market, side, odds, stake, note } = body ?? {};
  if (!game || !market || !side || !odds || !stake) {
    return NextResponse.json({ error: "game, market, side, odds and stake are required" }, { status: 400 });
  }
  const bets = readBets();
  const bet: Bet = {
    id: Math.random().toString(36).slice(2, 10),
    placedAt: new Date().toISOString(),
    game: String(game),
    market: String(market),
    side: String(side),
    odds: Number(odds),
    stake: Number(stake),
    status: "pending",
    note: note ? String(note) : undefined,
  };
  bets.push(bet);
  writeBets(bets);
  return NextResponse.json({ bet, stats: betStats(bets) });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, status } = body ?? {};
  if (!id || !["pending", "won", "lost", "void"].includes(status)) {
    return NextResponse.json({ error: "id and a valid status are required" }, { status: 400 });
  }
  const bets = readBets();
  const bet = bets.find((b) => b.id === id);
  if (!bet) return NextResponse.json({ error: "Bet not found" }, { status: 404 });
  bet.status = status;
  bet.settledAt = status === "pending" ? undefined : new Date().toISOString();
  writeBets(bets);
  return NextResponse.json({ bet, stats: betStats(bets) });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const bets = readBets().filter((b) => b.id !== id);
  writeBets(bets);
  return NextResponse.json({ ok: true, stats: betStats(bets) });
}
