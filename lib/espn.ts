import { cached } from "./cache";

const BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";
const HOUR = 3600_000;

async function get(url: string) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, cache: "no-store" });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

export type TeamInfo = {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  logo: string;
  color: string;
};

export async function getTeams(): Promise<TeamInfo[]> {
  return cached("teams", 24 * HOUR, async () => {
    const data = await get(`${BASE}/teams`);
    return data.sports[0].leagues[0].teams.map((t: any) => ({
      id: String(t.team.id),
      abbreviation: t.team.abbreviation,
      displayName: t.team.displayName,
      shortDisplayName: t.team.shortDisplayName,
      logo: t.team.logos?.[0]?.href ?? "",
      color: t.team.color ?? "444444",
    }));
  });
}

export type GameResult = {
  gameId: string;
  date: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  completed: boolean;
};

export async function getSchedule(teamId: string): Promise<GameResult[]> {
  return cached(`sched_${teamId}`, 6 * HOUR, async () => {
    const data = await get(`${BASE}/teams/${teamId}/schedule`);
    const out: GameResult[] = [];
    for (const ev of data.events ?? []) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const home = comp.competitors.find((c: any) => c.homeAway === "home");
      const away = comp.competitors.find((c: any) => c.homeAway === "away");
      if (!home || !away) continue;
      const completed = Boolean(home.score?.value !== undefined && comp.status?.type?.completed !== false && (comp.status?.type?.completed ?? home.score?.value !== undefined));
      out.push({
        gameId: String(ev.id),
        date: ev.date,
        homeId: String(home.team?.id ?? home.id),
        awayId: String(away.team?.id ?? away.id),
        homeScore: Number(home.score?.value ?? NaN),
        awayScore: Number(away.score?.value ?? NaN),
        completed: completed && !Number.isNaN(Number(home.score?.value)) && Number(home.score?.value) + Number(away.score?.value) > 0,
      });
    }
    return out;
  });
}

export type TeamStats = Record<string, number>;

export async function getTeamStats(teamId: string): Promise<TeamStats> {
  return cached(`stats_${teamId}`, 6 * HOUR, async () => {
    const data = await get(`${BASE}/teams/${teamId}/statistics`);
    const out: TeamStats = {};
    for (const cat of data.results?.stats?.categories ?? []) {
      for (const s of cat.stats ?? []) {
        out[s.name] = Number(s.value);
      }
    }
    return out;
  });
}

export type Injury = { athleteId: string; athlete: string; position: string; status: string; detail: string };

export async function getInjuries(): Promise<Record<string, Injury[]>> {
  return cached("injuries", 1 * HOUR, async () => {
    const data = await get(`${BASE}/injuries`);
    const out: Record<string, Injury[]> = {};
    for (const team of data.injuries ?? []) {
      const key = String(team.id);
      out[key] = (team.injuries ?? []).map((i: any) => {
        const href: string = i.athlete?.links?.[0]?.href ?? "";
        const m = href.match(/\/id\/(\d+)\//);
        return {
          athleteId: m ? m[1] : "",
          athlete: i.athlete?.displayName ?? "Unknown",
          position: i.athlete?.position?.abbreviation ?? "",
          status: i.status ?? "",
          detail: i.details?.type ?? i.shortComment ?? "",
        };
      });
    }
    return out;
  });
}

export async function getTeamScoring(teamId: string): Promise<Record<string, number>> {
  return cached(`scoring_${teamId}`, 12 * HOUR, async () => {
    const data = await get(
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/types/2/teams/${teamId}/leaders`
    );
    const out: Record<string, number> = {};
    const cat = (data.categories ?? []).find((c: any) => c.name === "pointsPerGame");
    for (const l of cat?.leaders ?? []) {
      const ref: string = l.athlete?.$ref ?? "";
      const m = ref.match(/athletes\/(\d+)/);
      if (m) out[m[1]] = Number(l.value);
    }
    return out;
  });
}

export type RosterPlayer = { id: string; name: string; position: string; jersey: string; headshot: string };

export async function getTeamRoster(teamId: string): Promise<RosterPlayer[]> {
  return cached(`roster_${teamId}`, 12 * HOUR, async () => {
    const data = await get(`${BASE}/teams/${teamId}/roster`);
    return (data.athletes ?? []).map((a: any) => ({
      id: String(a.id),
      name: a.displayName ?? "Unknown",
      position: a.position?.abbreviation ?? "",
      jersey: a.jersey ?? "",
      headshot: a.headshot?.href ?? `https://a.espncdn.com/i/headshots/nba/players/full/${a.id}.png`,
    }));
  });
}

export type TeamLeaders = Record<string, { ppg: number; rpg: number; apg: number; mpg: number }>;

export async function getTeamLeaders(teamId: string): Promise<TeamLeaders> {
  return cached(`leaders_${teamId}`, 12 * HOUR, async () => {
    const data = await get(
      `https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/seasons/2026/types/2/teams/${teamId}/leaders`
    );
    const maps: Record<string, Record<string, number>> = {};
    for (const catName of ["pointsPerGame", "reboundsPerGame", "assistsPerGame", "minutesPerGame"]) {
      const cat = (data.categories ?? []).find((c: any) => c.name === catName);
      const m: Record<string, number> = {};
      for (const l of cat?.leaders ?? []) {
        const ref: string = l.athlete?.$ref ?? "";
        const mm = ref.match(/athletes\/(\d+)/);
        if (mm) m[mm[1]] = Number(l.value);
      }
      maps[catName] = m;
    }
    const out: TeamLeaders = {};
    for (const id of Object.keys(maps.minutesPerGame ?? {})) {
      out[id] = {
        ppg: maps.pointsPerGame?.[id] ?? 0,
        rpg: maps.reboundsPerGame?.[id] ?? 0,
        apg: maps.assistsPerGame?.[id] ?? 0,
        mpg: maps.minutesPerGame?.[id] ?? 0,
      };
    }
    return out;
  });
}

export type UpcomingGame = {
  gameId: string;
  date: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
};

export type PlayerLine = { team: string; ppg: number; apg: number; rpg: number; mpg: number };

export async function getPlayerStats(): Promise<Record<string, PlayerLine>> {
  return cached("player_stats", 12 * HOUR, async () => {
    const data = await get(
      "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete?region=us&lang=en&contentorigin=espn&limit=450&sort=offensive.avgPoints:desc"
    );
    const out: Record<string, PlayerLine> = {};
    for (const row of data.athletes ?? []) {
      const name = String(row.athlete?.displayName ?? "").toLowerCase();
      if (!name) continue;
      const line: PlayerLine = { team: row.athlete?.teamShortName ?? "", ppg: 0, apg: 0, rpg: 0, mpg: 0 };
      for (const cat of row.categories ?? []) {
        const names: string[] = cat.names ?? [];
        const values: number[] = cat.values ?? [];
        const pick = (stat: string) => {
          const i = names.indexOf(stat);
          return i >= 0 ? Number(values[i] ?? 0) : 0;
        };
        if (cat.name === "offensive") {
          line.ppg = pick("avgPoints") || line.ppg;
          line.apg = pick("avgAssists") || line.apg;
        }
        if (cat.name === "general") {
          line.mpg = pick("avgMinutes") || line.mpg;
          line.rpg = pick("avgRebounds") || line.rpg;
        }
      }
      out[name] = line;
    }
    return out;
  });
}

export async function getUpcomingGames(days = 3): Promise<UpcomingGame[]> {
  return cached(`upcoming_${days}`, 1 * HOUR, async () => {
    const out: UpcomingGame[] = [];
    for (let d = 0; d < days; d++) {
      const dt = new Date(Date.now() + d * 86400_000);
      const ymd = dt.toISOString().slice(0, 10).replace(/-/g, "");
      const data = await get(`${BASE}/scoreboard?dates=${ymd}`);
      for (const ev of data.events ?? []) {
        if (ev.status?.type?.completed) continue;
        const comp = ev.competitions?.[0];
        const home = comp?.competitors?.find((c: any) => c.homeAway === "home");
        const away = comp?.competitors?.find((c: any) => c.homeAway === "away");
        if (!home || !away) continue;
        out.push({
          gameId: String(ev.id),
          date: ev.date,
          homeId: String(home.team.id),
          awayId: String(away.team.id),
          homeName: home.team.shortDisplayName,
          awayName: away.team.shortDisplayName,
        });
      }
    }
    const seen = new Set<string>();
    return out.filter((g) => !seen.has(g.gameId) && seen.add(g.gameId));
  });
}
