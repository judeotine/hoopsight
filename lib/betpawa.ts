import { buildLeagueModel, LeagueModel, TeamProfile } from "./analytics";
import { computeInjuryImpact, InjuredPlayer } from "./injuries";
import { predictMatchup } from "./model";

const ML_K = 0.145;
const TOTAL_K = 0.09;

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

export type SlipLeg = {
  eventId: string;
  sport: string;
  competition: string;
  home: string;
  away: string;
  startTime: string;
  market: string;
  selection: string;
  selectionLabel: string;
  handicap: number | null;
  price: number;
  bookmakerProb: number | null;
  assessed: boolean;
  modelProb: number | null;
  impliedProb: number;
  edge: number | null;
  verdict: "value" | "fair" | "bad" | "unknown";
  comment: string;
  details: LegDetails | null;
};

export type LegDetails = {
  homeAbbr: string;
  awayAbbr: string;
  homeLogo: string;
  awayLogo: string;
  homeRecord: string;
  awayRecord: string;
  homeSrs: number;
  awaySrs: number;
  homeForm: number;
  awayForm: number;
  homeLast5: string[];
  awayLast5: string[];
  homeWinProb: number;
  projectedHomeScore: number;
  projectedAwayScore: number;
  projectedMargin: number;
  projectedTotal: number;
  confidence: string;
  restNote: string | null;
  injuryNotes: string[];
  homeInjuries: InjuredPlayer[];
  awayInjuries: InjuredPlayer[];
  weakPoints: { team: string; label: string; detail: string }[];
};

type RawBooking = {
  items: {
    eventInfo: {
      id: string;
      participants: { name: string; position: number }[];
      startTime: string;
      competition: { name: string };
      category: { name: string };
    };
    selections: {
      market: { name: string; displayName: string; formattedHandicap: string };
      selectionInfo: { name: string; displayName: string; handicap: string };
    }[];
    odds: { price: number; probability?: { win: number } };
  }[];
};

export async function fetchBooking(code: string): Promise<RawBooking> {
  const res = await fetch(`https://www.betpawa.ug/api/sportsbook/v3/booking-number/${encodeURIComponent(code)}`, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json",
      "x-pawa-brand": "betpawa-uganda",
      "x-pawa-language": "en",
    },
    cache: "no-store",
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error === "BOOKING_CODE_NOT_FOUND" ? "Booking code not found on betPawa" : `betPawa error: ${body?.error ?? res.status}`);
  }
  return body;
}

function matchTeam(league: LeagueModel, name: string): TeamProfile | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const n = norm(name);
  for (const t of Object.values(league.teams)) {
    const d = norm(t.displayName);
    if (d === n || d.includes(n) || n.includes(d)) return t;
  }
  return null;
}

function parseHandicap(leg: RawBooking["items"][0]["selections"][0]): number | null {
  const raw = leg.selectionInfo.handicap || leg.market.formattedHandicap;
  if (!raw) return null;
  const v = Number(String(raw).replace(/[^\d.\-+]/g, ""));
  return Number.isFinite(v) ? v : null;
}

export async function analyzeBooking(code: string) {
  const [booking, league] = await Promise.all([fetchBooking(code), buildLeagueModel()]);

  const legs: SlipLeg[] = [];

  for (const item of booking.items) {
    const info = item.eventInfo;
    const homeName = info.participants.find((p) => p.position === 1)?.name ?? "";
    const awayName = info.participants.find((p) => p.position === 2)?.name ?? "";
    const sel = item.selections[0];
    const price = item.odds.price;
    const impliedProb = 1 / price;

    const base: Omit<SlipLeg, "assessed" | "modelProb" | "edge" | "verdict" | "comment" | "selectionLabel" | "details"> = {
      eventId: info.id,
      sport: info.category.name,
      competition: info.competition.name,
      home: homeName,
      away: awayName,
      startTime: info.startTime,
      market: sel?.market.displayName ?? "Unknown market",
      selection: sel?.selectionInfo.displayName ?? "?",
      handicap: sel ? parseHandicap(sel) : null,
      price,
      bookmakerProb: item.odds.probability?.win ?? null,
      impliedProb,
    };

    const notBasketball = info.category.name.toLowerCase() !== "basketball" || info.competition.name !== "NBA";
    const home = notBasketball ? null : matchTeam(league, homeName);
    const away = notBasketball ? null : matchTeam(league, awayName);

    if (notBasketball || !home || !away || !sel) {
      legs.push({
        ...base,
        selectionLabel: base.selection,
        assessed: false,
        modelProb: null,
        edge: null,
        verdict: "unknown",
        comment: notBasketball
          ? `${info.category.name} is outside the model, this leg is not assessed`
          : "Could not match these teams to NBA data",
        details: null,
      });
      continue;
    }

    const [homeImpact, awayImpact] = await Promise.all([
      computeInjuryImpact(home.id, home.abbreviation),
      computeInjuryImpact(away.id, away.abbreviation),
    ]);
    const p = predictMatchup(league, home, away, { home: homeImpact, away: awayImpact });

    const marketName = sel.market.name.toLowerCase();
    const selName = sel.selectionInfo.name.toLowerCase();
    let modelProb: number | null = null;
    let explain = "";
    let selectionLabel = base.selection;

    if (marketName.includes("moneyline") || marketName.includes("winner") || marketName.includes("1x2")) {
      if (selName === "1" || selName.includes("home")) {
        modelProb = p.homeWinProb;
        selectionLabel = `${home.displayName} to win`;
        explain = `${home.abbreviation} to win, model says ${(p.homeWinProb * 100).toFixed(0)}%`;
      } else if (selName === "2" || selName.includes("away")) {
        modelProb = p.awayWinProb;
        selectionLabel = `${away.displayName} to win`;
        explain = `${away.abbreviation} to win, model says ${(p.awayWinProb * 100).toFixed(0)}%`;
      }
    } else if (marketName.includes("handicap") && base.handicap !== null) {
      const h = base.handicap;
      const coverHome = sigmoid((p.projectedMargin + h) * ML_K);
      if (selName === "1" || selName.includes("home")) {
        modelProb = coverHome;
        selectionLabel = `${home.displayName} ${h > 0 ? "+" : ""}${h}`;
        explain = `${home.abbreviation} ${h > 0 ? "+" : ""}${h}, model margin ${p.projectedMargin.toFixed(1)}, cover ${(coverHome * 100).toFixed(0)}%`;
      } else if (selName === "2" || selName.includes("away")) {
        const coverAway = sigmoid((-p.projectedMargin + h) * ML_K);
        modelProb = coverAway;
        selectionLabel = `${away.displayName} ${h > 0 ? "+" : ""}${h}`;
        explain = `${away.abbreviation} ${h > 0 ? "+" : ""}${h}, model margin ${p.projectedMargin.toFixed(1)}, cover ${(coverAway * 100).toFixed(0)}%`;
      }
    } else if ((marketName.includes("total") || selName === "over" || selName === "under") && base.handicap !== null) {
      const line = base.handicap;
      const over = sigmoid((p.projectedTotal - line) * TOTAL_K);
      if (selName.includes("over")) {
        modelProb = over;
        selectionLabel = `Over ${line} points`;
        explain = `Over ${line}, model total ${p.projectedTotal.toFixed(0)}, probability ${(over * 100).toFixed(0)}%`;
      } else if (selName.includes("under")) {
        modelProb = 1 - over;
        selectionLabel = `Under ${line} points`;
        explain = `Under ${line}, model total ${p.projectedTotal.toFixed(0)}, probability ${((1 - over) * 100).toFixed(0)}%`;
      }
    }

    if (modelProb === null) {
      legs.push({
        ...base,
        selectionLabel,
        assessed: false,
        modelProb: null,
        edge: null,
        verdict: "unknown",
        comment: `Market "${sel.market.displayName}" is not supported by the model yet`,
        details: null,
      });
      continue;
    }

    const edge = modelProb - impliedProb;
    const verdict: SlipLeg["verdict"] = edge > 0.03 ? "value" : edge > -0.03 ? "fair" : "bad";
    const injuryBits = p.injuryNotes.length ? ` Note: ${p.injuryNotes.join("; ")}` : "";

    legs.push({
      ...base,
      selectionLabel,
      assessed: true,
      modelProb,
      edge,
      verdict,
      comment: `${explain} vs ${(impliedProb * 100).toFixed(0)}% implied by odds of ${price.toFixed(2)}.${injuryBits}`,
      details: {
        homeAbbr: home.abbreviation,
        awayAbbr: away.abbreviation,
        homeLogo: home.logo,
        awayLogo: away.logo,
        homeRecord: `${home.wins}-${home.losses}`,
        awayRecord: `${away.wins}-${away.losses}`,
        homeSrs: home.srs,
        awaySrs: away.srs,
        homeForm: home.formNet,
        awayForm: away.formNet,
        homeLast5: home.last10.slice(-5).map((g) => g.result),
        awayLast5: away.last10.slice(-5).map((g) => g.result),
        homeWinProb: p.homeWinProb,
        projectedHomeScore: p.projectedHomeScore,
        projectedAwayScore: p.projectedAwayScore,
        projectedMargin: p.projectedMargin,
        projectedTotal: p.projectedTotal,
        confidence: p.confidence,
        restNote: p.restNote,
        injuryNotes: p.injuryNotes,
        homeInjuries: homeImpact.players,
        awayInjuries: awayImpact.players,
        weakPoints: p.weakPoints.slice(0, 3).map((w) => ({ team: w.team, label: w.label, detail: w.detail })),
      },
    });
  }

  const assessed = legs.filter((l) => l.assessed && l.modelProb !== null);
  const slipModelProb = assessed.length ? assessed.reduce((a, l) => a + Math.log(l.modelProb as number), 0) : null;
  const comboOddsAssessed = assessed.reduce((a, l) => a * l.price, 1);
  const comboOddsAll = legs.reduce((a, l) => a * l.price, 1);
  const prob = slipModelProb !== null ? Math.exp(slipModelProb) : null;
  const ev = prob !== null && assessed.length ? prob * comboOddsAssessed - 1 : null;

  const weakest = assessed.length ? [...assessed].sort((a, b) => (a.modelProb as number) - (b.modelProb as number))[0] : null;

  let kellyFraction: number | null = null;
  if (prob !== null && assessed.length) {
    const b = comboOddsAssessed - 1;
    const f = (b * prob - (1 - prob)) / b;
    kellyFraction = Math.max(0, f);
  }

  const avgEdge = assessed.length
    ? assessed.reduce((a, l) => a + (l.edge as number), 0) / assessed.length
    : null;
  const lowConfidence = assessed.some((l) => l.details?.confidence === "low");

  let recommendation: "place" | "place_small" | "skip" | "no_opinion";
  let recommendationReason: string;
  if (!assessed.length || prob === null || ev === null) {
    recommendation = "no_opinion";
    recommendationReason = "No NBA legs could be priced, the model cannot judge this slip";
  } else if (ev <= 0 || (avgEdge !== null && avgEdge < 0.03)) {
    recommendation = "skip";
    recommendationReason = "The odds pay less than the real risk, long term this slip loses money";
  } else if (ev > 0.2 && prob >= 0.35 && !lowConfidence) {
    recommendation = "place";
    recommendationReason = "Clear value with a realistic hit rate, stake within the suggested ceiling";
  } else {
    recommendation = "place_small";
    recommendationReason = prob < 0.35
      ? "Positive value but a low hit rate, expect to lose this bet more often than win it, stake small"
      : "Positive value but thin margins or low data confidence, stake small";
  }

  let advice: string;
  if (!assessed.length) {
    advice = "No NBA legs could be assessed, the model has no opinion on this slip";
  } else if (ev !== null && ev > 0.08 && (prob as number) > 0.2) {
    advice = "The assessed legs carry positive expected value, this slip is playable at a sensible stake";
  } else if (ev !== null && ev > 0) {
    advice = "Marginally positive expected value, playable but keep the stake small";
  } else {
    advice = "The model prices this slip below what betPawa pays, the edge is with the bookmaker, skip it or restructure";
  }
  if (weakest && (weakest.modelProb as number) < 0.35 && assessed.length > 1) {
    advice += `. Weakest link: ${weakest.selection} on ${weakest.away} @ ${weakest.home} at ${((weakest.modelProb as number) * 100).toFixed(0)}% model probability, removing it raises the slip's chances materially`;
  }

  return {
    code,
    legs,
    summary: {
      totalLegs: legs.length,
      assessedLegs: assessed.length,
      slipModelProb: prob,
      comboOddsAssessed: assessed.length ? comboOddsAssessed : null,
      comboOddsAll,
      expectedValue: ev,
      kellyFraction,
      halfKellyFraction: kellyFraction !== null ? kellyFraction / 2 : null,
      recommendation,
      recommendationReason,
      advice,
    },
  };
}
