import fs from "fs";
import path from "path";

export type Bet = {
  id: string;
  placedAt: string;
  game: string;
  market: string;
  side: string;
  odds: number;
  stake: number;
  status: "pending" | "won" | "lost" | "void";
  settledAt?: string;
  note?: string;
};

const file = path.join(process.cwd(), "data", "bets.json");

export function readBets(): Bet[] {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

export function writeBets(bets: Bet[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(bets, null, 2));
}

export function betStats(bets: Bet[]) {
  const settled = bets.filter((b) => b.status === "won" || b.status === "lost");
  const staked = settled.reduce((a, b) => a + b.stake, 0);
  const returned = settled.reduce((a, b) => a + (b.status === "won" ? b.stake * b.odds : 0), 0);
  const profit = returned - staked;
  const wins = settled.filter((b) => b.status === "won").length;
  return {
    totalBets: bets.length,
    pending: bets.filter((b) => b.status === "pending").length,
    settled: settled.length,
    staked,
    returned,
    profit,
    roi: staked ? profit / staked : 0,
    winRate: settled.length ? wins / settled.length : 0,
  };
}
