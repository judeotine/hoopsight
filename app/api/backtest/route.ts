import { NextResponse } from "next/server";
import { cached } from "@/lib/cache";
import { getSchedule, getTeams, GameResult } from "@/lib/espn";

const HOME_ADVANTAGE = 2.8;

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

type HistoryEntry = { margin: number; opponent: string; date: string };

function computeSrs(history: Record<string, HistoryEntry[]>, ids: string[]): Record<string, number> {
  const avgMargin: Record<string, number> = {};
  const srs: Record<string, number> = {};
  for (const id of ids) {
    const h = history[id];
    avgMargin[id] = h.length ? h.reduce((a, g) => a + g.margin, 0) / h.length : 0;
    srs[id] = avgMargin[id];
  }
  for (let iter = 0; iter < 40; iter++) {
    for (const id of ids) {
      const h = history[id];
      const sos = h.length ? h.reduce((a, g) => a + (srs[g.opponent] ?? 0), 0) / h.length : 0;
      srs[id] = avgMargin[id] + sos;
    }
  }
  return srs;
}

export async function GET() {
  try {
    const result = await cached("backtest", 12 * 3600_000, async () => {
      const teams = await getTeams();
      const ids = teams.map((t) => t.id);
      const schedules = await Promise.all(teams.map((t) => getSchedule(t.id)));

      const seen = new Set<string>();
      const games: GameResult[] = schedules
        .flat()
        .filter((g) => g.completed && !seen.has(g.gameId) && seen.add(g.gameId))
        .sort((a, b) => a.date.localeCompare(b.date));

      const history: Record<string, HistoryEntry[]> = {};
      for (const id of ids) history[id] = [];

      type Pred = { prob: number; margin: number; actualMargin: number; homeWon: boolean; conf: string };
      const preds: Pred[] = [];

      for (const g of games) {
        if (!(g.homeId in history) || !(g.awayId in history)) continue;
        const hHist = history[g.homeId];
        const aHist = history[g.awayId];

        if (hHist.length >= 5 && aHist.length >= 5) {
          const srs = computeSrs(history, ids);

          const formOf = (h: HistoryEntry[]) => {
            const season = h.reduce((a, x) => a + x.margin, 0) / h.length;
            const last = h.slice(-10);
            const recent = last.reduce((a, x) => a + x.margin, 0) / last.length;
            return recent - season;
          };

          const restOf = (h: HistoryEntry[]) =>
            (new Date(g.date).getTime() - new Date(h[h.length - 1].date).getTime()) / 86400_000;

          let restAdj = 0;
          const rh = restOf(hHist);
          const ra = restOf(aHist);
          if (rh < 1.5 && ra >= 1.5) restAdj -= 1.5;
          else if (ra < 1.5 && rh >= 1.5) restAdj += 1.5;

          const margin =
            srs[g.homeId] - srs[g.awayId] + HOME_ADVANTAGE + restAdj + 0.25 * (formOf(hHist) - formOf(aHist));
          const prob = sigmoid(margin * 0.145);
          const gap = Math.abs(margin);
          const conf = gap > 7 ? "high" : gap > 3.5 ? "medium" : "low";

          preds.push({
            prob,
            margin,
            actualMargin: g.homeScore - g.awayScore,
            homeWon: g.homeScore > g.awayScore,
            conf,
          });
        }

        const m = g.homeScore - g.awayScore;
        history[g.homeId].push({ margin: m, opponent: g.awayId, date: g.date });
        history[g.awayId].push({ margin: -m, opponent: g.homeId, date: g.date });
      }

      const n = preds.length;
      let correct = 0, brier = 0, logLoss = 0, mae = 0;
      const buckets: Record<string, { n: number; wins: number; probSum: number }> = {};
      const byConf: Record<string, { n: number; correct: number }> = {
        high: { n: 0, correct: 0 },
        medium: { n: 0, correct: 0 },
        low: { n: 0, correct: 0 },
      };

      for (const p of preds) {
        const pickedHome = p.prob >= 0.5;
        const right = pickedHome === p.homeWon;
        if (right) correct++;
        const y = p.homeWon ? 1 : 0;
        brier += (p.prob - y) ** 2;
        logLoss += -(y * Math.log(Math.max(p.prob, 1e-9)) + (1 - y) * Math.log(Math.max(1 - p.prob, 1e-9)));
        mae += Math.abs(p.margin - p.actualMargin);

        const favProb = Math.max(p.prob, 1 - p.prob);
        const bucketKey = favProb < 0.6 ? "50-60" : favProb < 0.7 ? "60-70" : favProb < 0.8 ? "70-80" : favProb < 0.9 ? "80-90" : "90-100";
        buckets[bucketKey] ??= { n: 0, wins: 0, probSum: 0 };
        buckets[bucketKey].n++;
        buckets[bucketKey].probSum += favProb;
        if (right) buckets[bucketKey].wins++;

        byConf[p.conf].n++;
        if (right) byConf[p.conf].correct++;
      }

      const order = ["50-60", "60-70", "70-80", "80-90", "90-100"];
      return {
        gamesEvaluated: n,
        totalCompletedGames: games.length,
        accuracy: n ? correct / n : 0,
        brier: n ? brier / n : 0,
        logLoss: n ? logLoss / n : 0,
        marginMae: n ? mae / n : 0,
        calibration: order
          .filter((k) => buckets[k])
          .map((k) => ({
            bucket: k,
            games: buckets[k].n,
            predicted: buckets[k].probSum / buckets[k].n,
            actual: buckets[k].wins / buckets[k].n,
          })),
        byConfidence: Object.entries(byConf).map(([conf, v]) => ({
          confidence: conf,
          games: v.n,
          accuracy: v.n ? v.correct / v.n : 0,
        })),
        method:
          "Walk forward replay: every completed game is predicted using only data available before tip off, minimum 5 prior games per team",
        builtAt: new Date().toISOString(),
      };
    });

    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
