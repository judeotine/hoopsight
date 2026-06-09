import { cached } from "./cache";
import { getSchedule, getTeams, getTeamStats, GameResult } from "./espn";

export type TeamProfile = {
  id: string;
  abbreviation: string;
  displayName: string;
  logo: string;
  color: string;
  games: number;
  wins: number;
  losses: number;
  ppg: number;
  oppPpg: number;
  srs: number;
  adjOff: number;
  adjDef: number;
  pace: number;
  homeRecord: { w: number; l: number; margin: number };
  awayRecord: { w: number; l: number; margin: number };
  last10: { result: "W" | "L"; margin: number; opponent: string; date: string }[];
  formNet: number;
  fourFactors: { efg: number; tovPct: number; orebPg: number; ftRate: number; stealsPg: number; blocksPg: number };
  lastGameDate: string | null;
  nextGames: { date: string; opponentId: string; home: boolean }[];
};

export type LeagueModel = {
  teams: Record<string, TeamProfile>;
  leagueAvg: { ppg: number; efg: number; tovPct: number; orebPg: number; ftRate: number; stealsPg: number };
  builtAt: string;
};

const HOUR = 3600_000;

function dedupeGames(all: GameResult[]): GameResult[] {
  const seen = new Set<string>();
  return all.filter((g) => !seen.has(g.gameId) && seen.add(g.gameId));
}

export async function buildLeagueModel(): Promise<LeagueModel> {
  return cached("league_model", 6 * HOUR, async () => {
    const teams = await getTeams();
    const schedules = await Promise.all(teams.map((t) => getSchedule(t.id)));
    const statsAll = await Promise.all(teams.map((t) => getTeamStats(t.id)));

    const games = dedupeGames(schedules.flat()).filter((g) => g.completed);

    const ids = teams.map((t) => t.id);
    const margins: Record<string, number[]> = {};
    const opps: Record<string, string[]> = {};
    for (const id of ids) { margins[id] = []; opps[id] = []; }
    for (const g of games) {
      if (!(g.homeId in margins) || !(g.awayId in margins)) continue;
      const m = g.homeScore - g.awayScore;
      margins[g.homeId].push(m);
      margins[g.awayId].push(-m);
      opps[g.homeId].push(g.awayId);
      opps[g.awayId].push(g.homeId);
    }

    const srs: Record<string, number> = {};
    const avgMargin: Record<string, number> = {};
    for (const id of ids) {
      avgMargin[id] = margins[id].length ? margins[id].reduce((a, b) => a + b, 0) / margins[id].length : 0;
      srs[id] = avgMargin[id];
    }
    for (let iter = 0; iter < 60; iter++) {
      const next: Record<string, number> = {};
      for (const id of ids) {
        const sos = opps[id].length ? opps[id].reduce((a, o) => a + srs[o], 0) / opps[id].length : 0;
        next[id] = avgMargin[id] + sos;
      }
      Object.assign(srs, next);
    }

    const profiles: Record<string, TeamProfile> = {};
    let sumPpg = 0, sumEfg = 0, sumTov = 0, sumOreb = 0, sumFtr = 0, sumStl = 0;

    teams.forEach((t, idx) => {
      const sched = schedules[idx];
      const st = statsAll[idx];
      const played = sched
        .filter((g) => g.completed)
        .sort((a, b) => a.date.localeCompare(b.date));

      let wins = 0, losses = 0, pf = 0, pa = 0;
      const home = { w: 0, l: 0, margin: 0, n: 0 };
      const away = { w: 0, l: 0, margin: 0, n: 0 };
      for (const g of played) {
        const isHome = g.homeId === t.id;
        const my = isHome ? g.homeScore : g.awayScore;
        const their = isHome ? g.awayScore : g.homeScore;
        pf += my; pa += their;
        const won = my > their;
        if (won) wins++; else losses++;
        const side = isHome ? home : away;
        side.n++; side.margin += my - their;
        if (won) side.w++; else side.l++;
      }

      const last10 = played.slice(-10).map((g) => {
        const isHome = g.homeId === t.id;
        const my = isHome ? g.homeScore : g.awayScore;
        const their = isHome ? g.awayScore : g.homeScore;
        return {
          result: (my > their ? "W" : "L") as "W" | "L",
          margin: my - their,
          opponent: isHome ? g.awayId : g.homeId,
          date: g.date,
        };
      });
      const n = played.length || 1;
      const seasonMargin = (pf - pa) / n;
      const formMargin = last10.length ? last10.reduce((a, g) => a + g.margin, 0) / last10.length : 0;

      const fga = st.avgFieldGoalsAttempted ?? 0;
      const fgm = st.avgFieldGoalsMade ?? 0;
      const tpm = st.avgThreePointFieldGoalsMade ?? 0;
      const fta = st.avgFreeThrowsAttempted ?? 0;
      const ftm = st.avgFreeThrowsMade ?? 0;
      const tov = st.avgTurnovers ?? 0;
      const oreb = st.avgOffensiveRebounds ?? 0;

      const efg = fga ? (fgm + 0.5 * tpm) / fga : 0;
      const tovPct = fga + 0.44 * fta + tov ? tov / (fga + 0.44 * fta + tov) : 0;
      const ftRate = fga ? ftm / fga : 0;
      const pace = fga + 0.44 * fta + tov - oreb;

      const upcoming = sched
        .filter((g) => !g.completed && new Date(g.date).getTime() > Date.now() - 12 * HOUR)
        .sort((a, b) => a.date.localeCompare(b.date))
        .slice(0, 5)
        .map((g) => ({ date: g.date, opponentId: g.homeId === t.id ? g.awayId : g.homeId, home: g.homeId === t.id }));

      const ppg = pf / n;
      const oppPpg = pa / n;
      sumPpg += ppg; sumEfg += efg; sumTov += tovPct; sumOreb += oreb; sumFtr += ftRate; sumStl += st.avgSteals ?? 0;

      profiles[t.id] = {
        id: t.id,
        abbreviation: t.abbreviation,
        displayName: t.displayName,
        logo: t.logo,
        color: t.color,
        games: played.length,
        wins,
        losses,
        ppg,
        oppPpg,
        srs: srs[t.id] ?? 0,
        adjOff: ppg,
        adjDef: oppPpg,
        pace,
        homeRecord: { w: home.w, l: home.l, margin: home.n ? home.margin / home.n : 0 },
        awayRecord: { w: away.w, l: away.l, margin: away.n ? away.margin / away.n : 0 },
        last10,
        formNet: formMargin - seasonMargin,
        fourFactors: { efg, tovPct, orebPg: oreb, ftRate, stealsPg: st.avgSteals ?? 0, blocksPg: st.avgBlocks ?? 0 },
        lastGameDate: played.length ? played[played.length - 1].date : null,
        nextGames: upcoming,
      };
    });

    const N = teams.length;
    return {
      teams: profiles,
      leagueAvg: {
        ppg: sumPpg / N,
        efg: sumEfg / N,
        tovPct: sumTov / N,
        orebPg: sumOreb / N,
        ftRate: sumFtr / N,
        stealsPg: sumStl / N,
      },
      builtAt: new Date().toISOString(),
    };
  });
}
