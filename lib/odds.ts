import { cached } from "./cache";

export type OddsGame = {
  home_team: string;
  away_team: string;
  commence_time: string;
  bookmakers: {
    title: string;
    markets: { key: string; outcomes: { name: string; price: number; point?: number }[] }[];
  }[];
};

export type OddsInfo = {
  available: boolean;
  message?: string;
  bookmakers?: {
    book: string;
    homeOdds: number;
    awayOdds: number;
    homeImplied: number;
    awayImplied: number;
  }[];
  bestHome?: number;
  bestAway?: number;
  consensusHomeImplied?: number;
  consensusAwayImplied?: number;
  homeEdge?: number;
  awayEdge?: number;
  valueFlag?: string | null;
  spreadLine?: number | null;
  totalLine?: number | null;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

export async function fetchOddsBoard(): Promise<OddsGame[] | null> {
  const key = process.env.ODDS_API_KEY;
  if (!key) return null;
  try {
    return await cached("odds_board", 10 * 60_000, async () => {
      const res = await fetch(
        `https://api.the-odds-api.com/v4/sports/basketball_nba/odds?regions=us,eu&markets=h2h,spreads,totals&oddsFormat=decimal&apiKey=${key}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error(`Odds API ${res.status}`);
      return res.json();
    });
  } catch {
    return null;
  }
}

export function findOddsGame(games: OddsGame[], homeName: string, awayName: string): OddsGame | undefined {
  return games.find(
    (g) =>
      (norm(g.home_team).includes(norm(homeName)) || norm(homeName).includes(norm(g.home_team))) &&
      (norm(g.away_team).includes(norm(awayName)) || norm(awayName).includes(norm(g.away_team)))
  );
}

export function consensusSpread(game: OddsGame): number | null {
  const lines: number[] = [];
  for (const b of game.bookmakers) {
    const m = b.markets.find((m) => m.key === "spreads");
    const o = m?.outcomes.find((o) => norm(o.name) === norm(game.home_team));
    if (o?.point !== undefined) lines.push(o.point);
  }
  if (!lines.length) return null;
  lines.sort((a, b) => a - b);
  return lines[Math.floor(lines.length / 2)];
}

export function consensusTotal(game: OddsGame): number | null {
  const lines: number[] = [];
  for (const b of game.bookmakers) {
    const m = b.markets.find((m) => m.key === "totals");
    const o = m?.outcomes.find((o) => o.name === "Over");
    if (o?.point !== undefined) lines.push(o.point);
  }
  if (!lines.length) return null;
  lines.sort((a, b) => a - b);
  return lines[Math.floor(lines.length / 2)];
}

export function h2hBooks(game: OddsGame) {
  const books = [];
  for (const b of game.bookmakers) {
    const m = b.markets.find((m) => m.key === "h2h");
    if (!m) continue;
    const ho = m.outcomes.find((o) => norm(o.name) === norm(game.home_team));
    const ao = m.outcomes.find((o) => norm(o.name) === norm(game.away_team));
    if (!ho || !ao) continue;
    const rawH = 1 / ho.price;
    const rawA = 1 / ao.price;
    const s = rawH + rawA;
    books.push({
      book: b.title,
      homeOdds: ho.price,
      awayOdds: ao.price,
      homeImplied: rawH / s,
      awayImplied: rawA / s,
    });
  }
  return books;
}

export async function getOddsForMatchup(
  homeName: string,
  awayName: string,
  modelHomeProb: number
): Promise<OddsInfo> {
  const games = await fetchOddsBoard();
  if (!games) {
    return { available: false, message: "Set ODDS_API_KEY in .env.local to enable live bookmaker odds (free key at the-odds-api.com)" };
  }

  const game = findOddsGame(games, homeName, awayName);
  if (!game) {
    return { available: false, message: "No bookmaker odds listed for this matchup yet" };
  }

  const books = h2hBooks(game);
  if (!books.length) return { available: false, message: "No h2h markets found for this game" };

  const bestHome = Math.max(...books.map((b) => b.homeOdds));
  const bestAway = Math.max(...books.map((b) => b.awayOdds));
  const consensusHomeImplied = books.reduce((a, b) => a + b.homeImplied, 0) / books.length;
  const consensusAwayImplied = 1 - consensusHomeImplied;
  const homeEdge = modelHomeProb - consensusHomeImplied;
  const awayEdge = 1 - modelHomeProb - consensusAwayImplied;

  let valueFlag: string | null = null;
  if (homeEdge > 0.04) valueFlag = `Model sees value on the home side: ${(modelHomeProb * 100).toFixed(0)}% vs ${(consensusHomeImplied * 100).toFixed(0)}% implied by the books`;
  else if (awayEdge > 0.04) valueFlag = `Model sees value on the away side: ${((1 - modelHomeProb) * 100).toFixed(0)}% vs ${(consensusAwayImplied * 100).toFixed(0)}% implied by the books`;

  return {
    available: true,
    bookmakers: books.slice(0, 8),
    bestHome,
    bestAway,
    consensusHomeImplied,
    consensusAwayImplied,
    homeEdge,
    awayEdge,
    valueFlag,
    spreadLine: consensusSpread(game),
    totalLine: consensusTotal(game),
  };
}
