import { NextResponse } from "next/server";
import { buildLeagueModel } from "@/lib/analytics";
import { predictMatchup } from "@/lib/model";
import { getUpcomingGames } from "@/lib/espn";
import { computeInjuryImpact } from "@/lib/injuries";
import { consensusSpread, consensusTotal, fetchOddsBoard, findOddsGame, h2hBooks } from "@/lib/odds";

const ML_K = 0.145;
const TOTAL_K = 0.09;

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

export async function GET() {
  try {
    const [league, games, oddsBoard] = await Promise.all([
      buildLeagueModel(),
      getUpcomingGames(2),
      fetchOddsBoard(),
    ]);

    const rows = [];
    for (const g of games) {
      const home = league.teams[g.homeId];
      const away = league.teams[g.awayId];
      if (!home || !away) continue;

      const [homeImpact, awayImpact] = await Promise.all([
        computeInjuryImpact(home.id, home.abbreviation),
        computeInjuryImpact(away.id, away.abbreviation),
      ]);

      const p = predictMatchup(league, home, away, { home: homeImpact, away: awayImpact });

      const row: any = {
        gameId: g.gameId,
        date: g.date,
        home: { id: home.id, abbreviation: home.abbreviation, name: home.displayName, logo: home.logo, record: `${home.wins}-${home.losses}` },
        away: { id: away.id, abbreviation: away.abbreviation, name: away.displayName, logo: away.logo, record: `${away.wins}-${away.losses}` },
        modelHomeProb: p.homeWinProb,
        modelMargin: p.projectedMargin,
        modelTotal: p.projectedTotal,
        confidence: p.confidence,
        markets: { moneyline: null, spread: null, total: null },
        bestPlays: [] as { market: string; side: string; edge: number; detail: string }[],
      };

      const og = oddsBoard ? findOddsGame(oddsBoard, home.displayName, away.displayName) : undefined;
      if (og) {
        const books = h2hBooks(og);
        if (books.length) {
          const impliedHome = books.reduce((a, b) => a + b.homeImplied, 0) / books.length;
          const homeEdge = p.homeWinProb - impliedHome;
          const awayEdge = (1 - p.homeWinProb) - (1 - impliedHome);
          row.markets.moneyline = {
            impliedHome,
            bestHome: Math.max(...books.map((b) => b.homeOdds)),
            bestAway: Math.max(...books.map((b) => b.awayOdds)),
            homeEdge,
            awayEdge,
          };
          if (homeEdge > 0.04)
            row.bestPlays.push({ market: "moneyline", side: home.abbreviation, edge: homeEdge, detail: `${home.abbreviation} ML: model ${(p.homeWinProb * 100).toFixed(0)}% vs books ${(impliedHome * 100).toFixed(0)}%, best price ${Math.max(...books.map((b) => b.homeOdds)).toFixed(2)}` });
          if (awayEdge > 0.04)
            row.bestPlays.push({ market: "moneyline", side: away.abbreviation, edge: awayEdge, detail: `${away.abbreviation} ML: model ${((1 - p.homeWinProb) * 100).toFixed(0)}% vs books ${((1 - impliedHome) * 100).toFixed(0)}%, best price ${Math.max(...books.map((b) => b.awayOdds)).toFixed(2)}` });
        }

        const spread = consensusSpread(og);
        if (spread !== null) {
          const coverProbHome = sigmoid((p.projectedMargin + spread) * ML_K);
          row.markets.spread = {
            line: spread,
            modelMargin: p.projectedMargin,
            pointsEdge: p.projectedMargin + spread,
            coverProbHome,
          };
          if (coverProbHome > 0.56)
            row.bestPlays.push({ market: "spread", side: `${home.abbreviation} ${spread > 0 ? "+" : ""}${spread}`, edge: coverProbHome - 0.5, detail: `${home.abbreviation} ${spread > 0 ? "+" : ""}${spread}: model margin ${p.projectedMargin.toFixed(1)}, cover probability ${(coverProbHome * 100).toFixed(0)}%` });
          else if (coverProbHome < 0.44)
            row.bestPlays.push({ market: "spread", side: `${away.abbreviation} ${-spread > 0 ? "+" : ""}${-spread}`, edge: 0.5 - coverProbHome, detail: `${away.abbreviation} ${-spread > 0 ? "+" : ""}${-spread}: model margin ${p.projectedMargin.toFixed(1)}, cover probability ${((1 - coverProbHome) * 100).toFixed(0)}%` });
        }

        const total = consensusTotal(og);
        if (total !== null) {
          const overProb = sigmoid((p.projectedTotal - total) * TOTAL_K);
          row.markets.total = {
            line: total,
            modelTotal: p.projectedTotal,
            pointsDiff: p.projectedTotal - total,
            overProb,
          };
          if (overProb > 0.56)
            row.bestPlays.push({ market: "total", side: `Over ${total}`, edge: overProb - 0.5, detail: `Over ${total}: model projects ${p.projectedTotal.toFixed(0)} points, over probability ${(overProb * 100).toFixed(0)}%` });
          else if (overProb < 0.44)
            row.bestPlays.push({ market: "total", side: `Under ${total}`, edge: 0.5 - overProb, detail: `Under ${total}: model projects ${p.projectedTotal.toFixed(0)} points, under probability ${((1 - overProb) * 100).toFixed(0)}%` });
        }
      }

      row.bestPlays.sort((a: any, b: any) => b.edge - a.edge);
      row.maxEdge = row.bestPlays.length ? row.bestPlays[0].edge : 0;
      rows.push(row);
    }

    rows.sort((a, b) => b.maxEdge - a.maxEdge);

    return NextResponse.json({
      oddsAvailable: Boolean(oddsBoard),
      builtAt: league.builtAt,
      games: rows,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
