import { LeagueModel, TeamProfile } from "./analytics";

export type WeakPoint = { team: string; label: string; detail: string; severity: number };

export type Prediction = {
  homeWinProb: number;
  awayWinProb: number;
  projectedMargin: number;
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedTotal: number;
  confidence: "low" | "medium" | "high";
  pick: string;
  factors: { label: string; home: number; away: number; better: "home" | "away" | "even"; format: "pct" | "num" }[];
  weakPoints: WeakPoint[];
  restNote: string | null;
  injuryNotes: string[];
};

const HOME_ADVANTAGE = 2.8;

export type InjuryAdjustment = { penalty: number; notes: string[] };

function daysSince(dateIso: string | null): number {
  if (!dateIso) return 3;
  return (Date.now() - new Date(dateIso).getTime()) / 86400_000;
}

function winProbFromMargin(margin: number): number {
  return 1 / (1 + Math.exp(-margin * 0.145));
}

export function predictMatchup(
  league: LeagueModel,
  home: TeamProfile,
  away: TeamProfile,
  injuries?: { home: InjuryAdjustment; away: InjuryAdjustment }
): Prediction {
  const avg = league.leagueAvg;
  const homeInjuryPenalty = injuries?.home.penalty ?? 0;
  const awayInjuryPenalty = injuries?.away.penalty ?? 0;

  const restHome = daysSince(home.lastGameDate);
  const restAway = daysSince(away.lastGameDate);
  let restAdj = 0;
  let restNote: string | null = null;
  if (restHome < 1.5 && restAway >= 1.5) {
    restAdj -= 1.5;
    restNote = `${home.abbreviation} is on a back to back while ${away.abbreviation} is rested`;
  } else if (restAway < 1.5 && restHome >= 1.5) {
    restAdj += 1.5;
    restNote = `${away.abbreviation} is on a back to back while ${home.abbreviation} is rested`;
  }

  const formAdj = 0.25 * (home.formNet - away.formNet);
  const margin = home.srs - away.srs + HOME_ADVANTAGE + restAdj + formAdj - homeInjuryPenalty + awayInjuryPenalty;
  const homeWinProb = winProbFromMargin(margin);

  const homeExp = avg.ppg + (home.ppg - avg.ppg) + (away.oppPpg - avg.ppg) + HOME_ADVANTAGE / 2 + restAdj / 2 - homeInjuryPenalty * 0.6;
  const awayExp = avg.ppg + (away.ppg - avg.ppg) + (home.oppPpg - avg.ppg) - HOME_ADVANTAGE / 2 - restAdj / 2 - awayInjuryPenalty * 0.6;

  const sampleOk = home.games >= 8 && away.games >= 8;
  const gap = Math.abs(margin);
  const confidence: Prediction["confidence"] = !sampleOk ? "low" : gap > 7 ? "high" : gap > 3.5 ? "medium" : "low";

  const factors: Prediction["factors"] = [
    { label: "Effective FG%", home: home.fourFactors.efg, away: away.fourFactors.efg, format: "pct" as const },
    { label: "Turnover rate", home: home.fourFactors.tovPct, away: away.fourFactors.tovPct, format: "pct" as const },
    { label: "Offensive rebounds per game", home: home.fourFactors.orebPg, away: away.fourFactors.orebPg, format: "num" as const },
    { label: "Free throw rate", home: home.fourFactors.ftRate, away: away.fourFactors.ftRate, format: "pct" as const },
    { label: "Net rating (SRS)", home: home.srs, away: away.srs, format: "num" as const },
    { label: "Points per game", home: home.ppg, away: away.ppg, format: "num" as const },
    { label: "Points allowed per game", home: home.oppPpg, away: away.oppPpg, format: "num" as const },
  ].map((f) => {
    const lowerIsBetter = f.label === "Turnover rate" || f.label === "Points allowed per game";
    const diff = f.home - f.away;
    const better = Math.abs(diff) < 1e-6 ? "even" : (diff > 0) !== lowerIsBetter ? "home" : "away";
    return { ...f, better: better as "home" | "away" | "even" };
  });

  const weakPoints: WeakPoint[] = [];
  const addWeak = (team: TeamProfile, opp: TeamProfile) => {
    const f = team.fourFactors;
    if (f.efg < avg.efg - 0.005)
      weakPoints.push({ team: team.abbreviation, label: "Poor shooting efficiency", detail: `eFG% of ${(f.efg * 100).toFixed(1)} sits below the league average of ${(avg.efg * 100).toFixed(1)}`, severity: (avg.efg - f.efg) * 100 });
    if (f.tovPct > avg.tovPct + 0.003) {
      const pressure = opp.fourFactors.stealsPg > avg.stealsPg ? ` and ${opp.abbreviation} forces turnovers at an above average rate (${opp.fourFactors.stealsPg.toFixed(1)} steals per game)` : "";
      weakPoints.push({ team: team.abbreviation, label: "Turnover prone", detail: `Turnover rate of ${(f.tovPct * 100).toFixed(1)}% is worse than the league average${pressure}`, severity: (f.tovPct - avg.tovPct) * 200 });
    }
    if (f.orebPg < avg.orebPg - 0.5)
      weakPoints.push({ team: team.abbreviation, label: "Weak on the offensive glass", detail: `${f.orebPg.toFixed(1)} offensive rebounds per game against a league average of ${avg.orebPg.toFixed(1)}`, severity: avg.orebPg - f.orebPg });
    if (team.oppPpg > avg.ppg + 2)
      weakPoints.push({ team: team.abbreviation, label: "Leaky defense", detail: `Allows ${team.oppPpg.toFixed(1)} points per game, ${(team.oppPpg - avg.ppg).toFixed(1)} above league average`, severity: (team.oppPpg - avg.ppg) / 2 });
    if (team.awayRecord.l > team.awayRecord.w && opp.id !== team.id && team.id !== home.id)
      weakPoints.push({ team: team.abbreviation, label: "Struggles on the road", detail: `${team.awayRecord.w}-${team.awayRecord.l} away from home with an average margin of ${team.awayRecord.margin.toFixed(1)}`, severity: 1.5 });
    if (team.formNet < -3)
      weakPoints.push({ team: team.abbreviation, label: "Cold streak", detail: `Playing ${Math.abs(team.formNet).toFixed(1)} points per game below season level over the last 10`, severity: Math.abs(team.formNet) / 2 });
  };
  addWeak(home, away);
  addWeak(away, home);
  if (homeInjuryPenalty > 1.5)
    weakPoints.push({ team: home.abbreviation, label: "Key players sidelined", detail: `Injuries cost an estimated ${homeInjuryPenalty.toFixed(1)} points of margin`, severity: homeInjuryPenalty });
  if (awayInjuryPenalty > 1.5)
    weakPoints.push({ team: away.abbreviation, label: "Key players sidelined", detail: `Injuries cost an estimated ${awayInjuryPenalty.toFixed(1)} points of margin`, severity: awayInjuryPenalty });
  weakPoints.sort((a, b) => b.severity - a.severity);

  const favored = homeWinProb >= 0.5 ? home : away;
  const prob = Math.max(homeWinProb, 1 - homeWinProb);

  return {
    homeWinProb,
    awayWinProb: 1 - homeWinProb,
    projectedMargin: margin,
    projectedHomeScore: homeExp,
    projectedAwayScore: awayExp,
    projectedTotal: homeExp + awayExp,
    confidence,
    pick: `${favored.displayName} to win (${(prob * 100).toFixed(0)}% model probability)`,
    factors,
    weakPoints: weakPoints.slice(0, 6),
    restNote,
    injuryNotes: [...(injuries?.home.notes ?? []), ...(injuries?.away.notes ?? [])],
  };
}
