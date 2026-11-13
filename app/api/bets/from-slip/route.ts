import { NextRequest, NextResponse } from "next/server";
import { analyzeBooking } from "@/lib/betpawa";
import { Bet, betStats, readBets, writeBets } from "@/lib/bets";
import { legsFromSlip } from "@/lib/settle";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { code, stake } = body ?? {};
  if (!code || !stake || Number(stake) <= 0) {
    return NextResponse.json({ error: "code and stake are required" }, { status: 400 });
  }

  try {
    const analysis = await analyzeBooking(String(code).toUpperCase());
    const { betLegs, allTrackable } = legsFromSlip(analysis.legs);
    const comboOdds = analysis.legs.reduce((a, l) => a * l.price, 1);

    const bets = readBets();
    const bet: Bet = {
      id: Math.random().toString(36).slice(2, 10),
      placedAt: new Date().toISOString(),
      game: `betPawa slip ${analysis.code}`,
      market: analysis.legs.length > 1 ? "multi" : betLegs[0]?.market ?? "other",
      side: analysis.legs.map((l) => l.selectionLabel).join(" + "),
      odds: comboOdds,
      stake: Number(stake),
      status: "pending",
      note:
        analysis.summary.slipModelProb !== null
          ? `model ${(analysis.summary.slipModelProb * 100).toFixed(1)}% EV ${((analysis.summary.expectedValue ?? 0) * 100).toFixed(0)}%`
          : undefined,
      legs: betLegs,
      autoTrack: allTrackable && betLegs.length === analysis.legs.length,
    };
    bets.push(bet);
    writeBets(bets);

    return NextResponse.json({ bet, stats: betStats(bets) });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
