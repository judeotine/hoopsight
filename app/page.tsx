"use client";

import { useEffect, useMemo, useState } from "react";

type Team = {
  id: string;
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  logo: string;
  color: string;
};

type UpcomingGame = {
  gameId: string;
  date: string;
  homeId: string;
  awayId: string;
  homeName: string;
  awayName: string;
};

type Profile = Team & {
  games: number;
  wins: number;
  losses: number;
  ppg: number;
  oppPpg: number;
  srs: number;
  homeRecord: { w: number; l: number; margin: number };
  awayRecord: { w: number; l: number; margin: number };
  last10: { result: "W" | "L"; margin: number; opponent: string; date: string }[];
  formNet: number;
  fourFactors: { efg: number; tovPct: number; orebPg: number; ftRate: number; stealsPg: number; blocksPg: number };
};

type Report = {
  home: Profile;
  away: Profile;
  builtAt: string;
  prediction: {
    homeWinProb: number;
    awayWinProb: number;
    projectedMargin: number;
    projectedHomeScore: number;
    projectedAwayScore: number;
    projectedTotal: number;
    confidence: string;
    pick: string;
    factors: { label: string; home: number; away: number; better: string; format: string }[];
    weakPoints: { team: string; label: string; detail: string }[];
    restNote: string | null;
  };
  headToHead: { date: string; completed: boolean; homeId: string; awayId: string; homeScore: number | null; awayScore: number | null }[];
  injuries: { home: Injury[]; away: Injury[] };
  odds: Odds;
};

type Injury = { athlete: string; position: string; status: string; detail: string };

type Odds = {
  available: boolean;
  message?: string;
  bookmakers?: { book: string; homeOdds: number; awayOdds: number; homeImplied: number; awayImplied: number }[];
  bestHome?: number;
  bestAway?: number;
  consensusHomeImplied?: number;
  homeEdge?: number;
  awayEdge?: number;
  valueFlag?: string | null;
};

function fmtFactor(v: number, format: string) {
  return format === "pct" ? (v * 100).toFixed(1) + "%" : v.toFixed(1);
}

function Panel({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <section
      className="fade-up rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5"
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--dim)]">{children}</div>;
}

export default function Home() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [games, setGames] = useState<UpcomingGame[]>([]);
  const [homeId, setHomeId] = useState("");
  const [awayId, setAwayId] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/teams").then((r) => r.json()).then(setTeams).catch(() => setError("Failed to load teams"));
    fetch("/api/games").then((r) => r.json()).then((g) => Array.isArray(g) && setGames(g)).catch(() => {});
  }, []);

  const teamById = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t])), [teams]);

  async function analyze(h = homeId, a = awayId) {
    if (!h || !a || h === a) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch(`/api/matchup?home=${h}&away=${a}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      setReport(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function pickGame(g: UpcomingGame) {
    setHomeId(g.homeId);
    setAwayId(g.awayId);
    analyze(g.homeId, g.awayId);
  }

  const p = report?.prediction;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10">
      <header className="fade-up mb-10 flex items-end justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[var(--accent)] pulse-dot" />
            <Label>NBA matchup intelligence</Label>
          </div>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">HoopSight</h1>
        </div>
        <div className="text-right text-xs text-[var(--dim)]">
          Data: ESPN public API
          <br />
          Model: SRS + Four Factors + rest
        </div>
      </header>

      {games.length > 0 && (
        <div className="fade-up mb-8" style={{ animationDelay: "80ms" }}>
          <Label>Upcoming games, tap to analyze</Label>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-2">
            {games.map((g) => (
              <button
                key={g.gameId}
                onClick={() => pickGame(g)}
                className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-left text-sm transition-colors hover:border-[var(--accent)]"
              >
                <div className="font-medium">{g.awayName} @ {g.homeName}</div>
                <div className="mt-0.5 font-mono text-[11px] text-[var(--dim)]">
                  {new Date(g.date).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="fade-up mb-10 flex flex-wrap items-end gap-3" style={{ animationDelay: "140ms" }}>
        <div className="flex-1 min-w-48">
          <Label>Home team</Label>
          <select
            value={homeId}
            onChange={(e) => setHomeId(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">Select team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.displayName}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => { const h = homeId; setHomeId(awayId); setAwayId(h); }}
          className="rounded-md border border-[var(--line)] px-3 py-2.5 text-sm text-[var(--dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--foreground)]"
          title="Swap sides"
        >
          ⇄
        </button>
        <div className="flex-1 min-w-48">
          <Label>Away team</Label>
          <select
            value={awayId}
            onChange={(e) => setAwayId(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-[var(--line)] bg-[var(--panel)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
          >
            <option value="">Select team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.displayName}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => analyze()}
          disabled={!homeId || !awayId || homeId === awayId || loading}
          className="rounded-md bg-[var(--accent)] px-6 py-2.5 text-sm font-semibold text-black transition-opacity disabled:opacity-40"
        >
          {loading ? "Analyzing..." : "Analyze matchup"}
        </button>
      </div>

      {error && (
        <div className="fade-up mb-6 rounded-md border border-red-900 bg-red-950/40 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {loading && (
        <div className="fade-up rounded-lg border border-[var(--line)] bg-[var(--panel)] p-10 text-center text-sm text-[var(--dim)]">
          Building league model from every team schedule, first run takes a few seconds
        </div>
      )}

      {report && p && (
        <div className="grid gap-4">
          <Panel>
            <div className="flex items-center justify-between gap-4">
              {[report.home, report.away].map((t, i) => (
                <div key={t.id} className={`flex items-center gap-3 ${i === 1 ? "flex-row-reverse text-right" : ""}`}>
                  {t.logo && <img src={t.logo} alt={t.abbreviation} className="h-14 w-14" />}
                  <div>
                    <div className="text-lg font-semibold leading-tight">{t.displayName}</div>
                    <div className="font-mono text-xs text-[var(--dim)]">
                      {t.wins}-{t.losses} · {i === 0 ? "home" : "away"} {i === 0 ? `${t.homeRecord.w}-${t.homeRecord.l}` : `${t.awayRecord.w}-${t.awayRecord.l}`} · SRS {t.srs.toFixed(1)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5">
              <div className="flex justify-between font-mono text-xs text-[var(--dim)]">
                <span>{report.home.abbreviation} {(p.homeWinProb * 100).toFixed(0)}%</span>
                <span>win probability</span>
                <span>{(p.awayWinProb * 100).toFixed(0)}% {report.away.abbreviation}</span>
              </div>
              <div className="mt-1.5 flex h-3 overflow-hidden rounded-full bg-[var(--line)]">
                <div className="grow-bar h-full bg-[var(--accent)]" style={{ width: `${p.homeWinProb * 100}%` }} />
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <Label>Projected score</Label>
                <div className="mt-1 text-xl font-semibold">
                  {p.projectedHomeScore.toFixed(0)} - {p.projectedAwayScore.toFixed(0)}
                </div>
              </div>
              <div>
                <Label>Projected total</Label>
                <div className="mt-1 text-xl font-semibold">{p.projectedTotal.toFixed(0)}</div>
              </div>
              <div>
                <Label>Margin</Label>
                <div className="mt-1 text-xl font-semibold">
                  {report.home.abbreviation} {p.projectedMargin > 0 ? "+" : ""}{p.projectedMargin.toFixed(1)}
                </div>
              </div>
              <div>
                <Label>Confidence</Label>
                <div className="mt-1 text-xl font-semibold capitalize">{p.confidence}</div>
              </div>
            </div>

            <div className="mt-4 rounded-md border border-[var(--line)] bg-black/30 px-4 py-3">
              <Label>Model pick</Label>
              <div className="mt-1 text-sm font-medium">{p.pick}</div>
              {p.restNote && <div className="mt-1 text-xs text-[var(--dim)]">{p.restNote}</div>}
            </div>
          </Panel>

          <Panel delay={80}>
            <Label>Recent form, last 10</Label>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {[report.home, report.away].map((t) => (
                <div key={t.id}>
                  <div className="mb-1.5 text-sm font-medium">{t.displayName}</div>
                  <div className="flex gap-1.5">
                    {t.last10.map((g, i) => (
                      <span
                        key={i}
                        title={`${g.result} ${g.margin > 0 ? "+" : ""}${g.margin} vs ${teamById[g.opponent]?.abbreviation ?? g.opponent}`}
                        className={`flex h-7 w-7 items-center justify-center rounded font-mono text-[11px] font-bold ${
                          g.result === "W" ? "bg-emerald-600/90 text-black" : "bg-[var(--line)] text-[var(--dim)]"
                        }`}
                      >
                        {g.result}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1.5 font-mono text-xs text-[var(--dim)]">
                    form vs season level: {t.formNet > 0 ? "+" : ""}{t.formNet.toFixed(1)} pts
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel delay={140}>
            <Label>Factor comparison</Label>
            <div className="mt-3 grid gap-3">
              {p.factors.map((f) => (
                <div key={f.label} className="grid grid-cols-[70px_1fr_70px] items-center gap-3 text-sm">
                  <span className={`font-mono text-right ${f.better === "home" ? "text-[var(--accent)] font-semibold" : ""}`}>
                    {fmtFactor(f.home, f.format)}
                  </span>
                  <div className="text-center text-xs text-[var(--dim)]">{f.label}</div>
                  <span className={`font-mono ${f.better === "away" ? "text-[var(--accent)] font-semibold" : ""}`}>
                    {fmtFactor(f.away, f.format)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel delay={200}>
            <Label>Weak points</Label>
            {p.weakPoints.length === 0 ? (
              <div className="mt-2 text-sm text-[var(--dim)]">No notable weaknesses flagged on either side</div>
            ) : (
              <div className="mt-3 grid gap-2">
                {p.weakPoints.map((w, i) => (
                  <div key={i} className="rounded-md border border-[var(--line)] bg-black/30 px-4 py-2.5">
                    <div className="text-sm font-medium">
                      <span className="font-mono text-[var(--accent)]">{w.team}</span> · {w.label}
                    </div>
                    <div className="mt-0.5 text-xs text-[var(--dim)]">{w.detail}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel delay={260}>
            <Label>Injuries</Label>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              {([["home", report.home], ["away", report.away]] as const).map(([side, t]) => (
                <div key={side}>
                  <div className="mb-1.5 text-sm font-medium">{t.displayName}</div>
                  {report.injuries[side].length === 0 ? (
                    <div className="text-xs text-[var(--dim)]">No reported injuries</div>
                  ) : (
                    <ul className="grid gap-1 text-xs">
                      {report.injuries[side].slice(0, 8).map((inj, i) => (
                        <li key={i} className="flex justify-between gap-2">
                          <span>{inj.athlete} <span className="text-[var(--dim)]">{inj.position}</span></span>
                          <span className={`font-mono ${inj.status === "Out" ? "text-red-400" : "text-[var(--dim)]"}`}>{inj.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Panel>

          <Panel delay={320}>
            <Label>Head to head this season</Label>
            {report.headToHead.length === 0 ? (
              <div className="mt-2 text-sm text-[var(--dim)]">No meetings scheduled this season</div>
            ) : (
              <div className="mt-3 grid gap-1.5 text-sm">
                {report.headToHead.map((g, i) => (
                  <div key={i} className="flex items-center justify-between rounded-md border border-[var(--line)] px-4 py-2">
                    <span className="font-mono text-xs text-[var(--dim)]">
                      {new Date(g.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </span>
                    <span>
                      {teamById[g.awayId]?.abbreviation} @ {teamById[g.homeId]?.abbreviation}
                    </span>
                    <span className="font-mono">
                      {g.completed ? `${g.awayScore} - ${g.homeScore}` : "upcoming"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel delay={380}>
            <Label>Bookmaker odds vs model</Label>
            {!report.odds.available ? (
              <div className="mt-2 text-sm text-[var(--dim)]">{report.odds.message}</div>
            ) : (
              <>
                {report.odds.valueFlag && (
                  <div className="mt-3 rounded-md border border-[var(--accent)] bg-[var(--accent)]/10 px-4 py-2.5 text-sm font-medium text-[var(--accent)]">
                    Value spotted: {report.odds.valueFlag}
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <Label>Model {report.home.abbreviation}</Label>
                    <div className="mt-1 font-mono text-lg">{(p.homeWinProb * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <Label>Books {report.home.abbreviation}</Label>
                    <div className="mt-1 font-mono text-lg">{((report.odds.consensusHomeImplied ?? 0) * 100).toFixed(0)}%</div>
                  </div>
                  <div>
                    <Label>Edge</Label>
                    <div className={`mt-1 font-mono text-lg ${(report.odds.homeEdge ?? 0) > 0.04 || (report.odds.awayEdge ?? 0) > 0.04 ? "text-[var(--accent)]" : ""}`}>
                      {((Math.max(report.odds.homeEdge ?? 0, report.odds.awayEdge ?? 0)) * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>
                <table className="mt-4 w-full text-left text-xs">
                  <thead className="font-mono uppercase tracking-wider text-[var(--dim)]">
                    <tr>
                      <th className="py-1.5">Book</th>
                      <th className="py-1.5 text-right">{report.home.abbreviation}</th>
                      <th className="py-1.5 text-right">{report.away.abbreviation}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.odds.bookmakers?.map((b) => (
                      <tr key={b.book} className="border-t border-[var(--line)]">
                        <td className="py-1.5">{b.book}</td>
                        <td className={`py-1.5 text-right font-mono ${b.homeOdds === report.odds.bestHome ? "text-[var(--accent)]" : ""}`}>{b.homeOdds.toFixed(2)}</td>
                        <td className={`py-1.5 text-right font-mono ${b.awayOdds === report.odds.bestAway ? "text-[var(--accent)]" : ""}`}>{b.awayOdds.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Panel>

          <footer className="fade-up pb-6 pt-2 text-center text-xs text-[var(--dim)]" style={{ animationDelay: "440ms" }}>
            Model built {new Date(report.builtAt).toLocaleString()} · predictions are probabilistic, not guarantees · stake responsibly
          </footer>
        </div>
      )}

      {!report && !loading && !error && (
        <div className="fade-up rounded-lg border border-dashed border-[var(--line)] p-12 text-center text-sm text-[var(--dim)]" style={{ animationDelay: "200ms" }}>
          Pick an upcoming game above or choose two teams to generate a full matchup report
        </div>
      )}
    </main>
  );
}
