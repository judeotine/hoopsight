import { Bet, BetLeg, readBets, writeBets } from "./bets";
import { getSchedule, getTeams, GameResult } from "./espn";

function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

async function resolveTeamId(name: string): Promise<string | null> {
  const teams = await getTeams();
  const n = norm(name);
  for (const t of teams) {
    const d = norm(t.displayName);
    if (d === n || d.includes(n) || n.includes(d)) return t.id;
  }
  return null;
}

async function findGame(leg: BetLeg): Promise<GameResult | null> {
  const homeId = await resolveTeamId(leg.home);
  const awayId = await resolveTeamId(leg.away);
  if (!homeId || !awayId) return null;
  const sched = await getSchedule(homeId);
  const legTime = new Date(leg.date).getTime();
  for (const g of sched) {
    if (g.homeId !== homeId || g.awayId !== awayId) continue;
    if (Math.abs(new Date(g.date).getTime() - legTime) > 36 * 3600_000) continue;
    return g;
  }
  return null;
}

function gradeLeg(leg: BetLeg, g: GameResult): "won" | "lost" | "push" {
  const margin = g.homeScore - g.awayScore;
  const total = g.homeScore + g.awayScore;

  if (leg.market === "moneyline") {
    const homeWon = margin > 0;
    return (leg.selection === "home") === homeWon ? "won" : "lost";
  }
  if (leg.market === "spread" && leg.line !== null) {
    const adj = leg.selection === "home" ? margin + leg.line : -margin + leg.line;
    if (adj > 0) return "won";
    if (adj < 0) return "lost";
    return "push";
  }
  if (leg.market === "total" && leg.line !== null) {
    if (total === leg.line) return "push";
    const over = total > leg.line;
    return (leg.selection === "over") === over ? "won" : "lost";
  }
  return "push";
}

export async function autoSettleBets(): Promise<number> {
  const bets = readBets();
  let changed = 0;

  for (const bet of bets) {
    if (bet.status !== "pending" || !bet.autoTrack || !bet.legs?.length) continue;

    let allResolved = true;
    let anyLost = false;
    let anyPush = false;

    for (const leg of bet.legs) {
      if (leg.result) {
        if (leg.result === "lost") anyLost = true;
        if (leg.result === "push") anyPush = true;
        continue;
      }
      let game: GameResult | null = null;
      try {
        game = await findGame(leg);
      } catch {
        game = null;
      }
      if (!game || !game.completed) {
        allResolved = false;
        continue;
      }
      leg.result = gradeLeg(leg, game);
      leg.finalScore = `${game.awayScore}-${game.homeScore}`;
      if (leg.result === "lost") anyLost = true;
      if (leg.result === "push") anyPush = true;
    }

    if (anyLost) {
      bet.status = "lost";
      bet.settledAt = new Date().toISOString();
      bet.settledBy = "auto";
      changed++;
    } else if (allResolved) {
      bet.status = anyPush ? "void" : "won";
      bet.settledAt = new Date().toISOString();
      bet.settledBy = "auto";
      changed++;
    }
  }

  if (changed) writeBets(bets);
  return changed;
}

export function legsFromSlip(legs: {
  assessed: boolean;
  home: string;
  away: string;
  startTime: string;
  market: string;
  selection: string;
  selectionLabel: string;
  handicap: number | null;
}[]): { betLegs: BetLeg[]; allTrackable: boolean } {
  const betLegs: BetLeg[] = [];
  let allTrackable = true;

  for (const l of legs) {
    const m = l.market.toLowerCase();
    const sel = l.selection.toLowerCase();
    let market: BetLeg["market"] | null = null;
    let selection: BetLeg["selection"] | null = null;

    if (m.includes("moneyline") || m.includes("winner") || m.includes("1x2")) {
      market = "moneyline";
      selection = sel === "1" ? "home" : sel === "2" ? "away" : null;
    } else if (m.includes("handicap")) {
      market = "spread";
      selection = sel === "1" ? "home" : sel === "2" ? "away" : null;
    } else if (m.includes("total") || sel === "over" || sel === "under") {
      market = "total";
      selection = sel === "over" ? "over" : sel === "under" ? "under" : null;
    }

    if (!market || !selection || (market !== "moneyline" && l.handicap === null)) {
      allTrackable = false;
      continue;
    }

    betLegs.push({
      home: l.home,
      away: l.away,
      date: l.startTime,
      market,
      selection,
      line: l.handicap,
      label: l.selectionLabel,
    });
  }

  return { betLegs, allTrackable: allTrackable && betLegs.length > 0 };
}
