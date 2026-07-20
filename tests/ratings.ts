/**
 * Deterministic tests for the experimental ratings module. Runs via
 * `bun run test:deterministic`. No RNG, no Supabase, no globals.
 */
import {
  buildEnvironment, popStdev, zToRating, shrinkZ, twoWay,
  computeSeasonRatings, computeCareerRatings,
  leaderboardOffense, leaderboardDefense, leaderboardTwoWay,
  careerRatingQuality, combineAliasRatings,
  type RatingGame, type RatingFrameStats, type BowlerRatings,
} from "../src/lib/ratings";
import { frameStatsFromLinescore } from "../src/lib/ratings-extract";
import { readFileSync } from "node:fs";


function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("ratings: " + msg);
}
function approx(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

// ---------- helpers ----------
const NO_FRAME: RatingFrameStats | undefined = undefined;
function scoreGame(
  person: string, opp: string | null, week: number, lane: string, score: number,
  entryAverage: number | null = null, frame: RatingFrameStats | null = null,
): RatingGame {
  return { seasonId: "S", weekNumber: week, lanePair: lane, personRef: person,
           opponentRef: opp, scratchScore: score,
           entryAverage: entryAverage ?? undefined, frame: frame ?? NO_FRAME };
}
function fullFrame(strikes: number, spares: number, opens: number, cm = 0, co = 2): RatingFrameStats {
  return { framesRolled: 10, strikes, spares, opens, clutchMarks: cm, clutchOpportunities: co };
}

// ---------- 1) environment adjustment fallback ----------
(function envFallback() {
  // Build a season with a hot week+lane cell (6 games avg 180), season mean 100.
  const rows: RatingGame[] = [];
  // 20 baseline scores of 100 across various weeks/lanes
  for (let i = 0; i < 20; i++) {
    rows.push(scoreGame(`p${i}`, null, 2 + (i % 3), "3-4", 100));
  }
  // one specific cell wk1 lane 1-2 with 6 hot scores 180
  for (let i = 0; i < 6; i++) rows.push(scoreGame(`h${i}`, null, 1, "1-2", 180));
  const env = buildEnvironment(rows);
  const before = 180;
  const adjusted = env.adjust(scoreGame("hX", null, 1, "1-2", before));
  // cell mean 180, season mean = (20*100 + 6*180)/26 = (2000+1080)/26 ≈ 118.46
  const seasonMean = (20 * 100 + 6 * 180) / 26;
  assert(approx(env.seasonMean, seasonMean), "season mean matches");
  assert(approx(adjusted, before - (180 - seasonMean)), "wk+lane env adjust applied");

  // If cell has <6 games, fall back to week; if week too, season.
  const rows2: RatingGame[] = [];
  for (let i = 0; i < 20; i++) rows2.push(scoreGame(`p${i}`, null, 1, "3-4", 100));
  const env2 = buildEnvironment(rows2);
  const adj2 = env2.adjust(scoreGame("x", null, 1, "9-10", 150));
  // wk mean 100, season mean 100 → adj = 150-0 = 150
  assert(approx(adj2, 150), "no adjustment when means equal");
})();

// ---------- 2) 100-centered standardization and zero-variance omission ----------
(function standardization() {
  // Everyone identical -> stdev 0 -> rating null (component omitted; nothing left → null).
  const rows: RatingGame[] = [];
  for (let i = 0; i < 6; i++) {
    for (let g = 0; g < 3; g++) rows.push(scoreGame(`p${i}`, `p${(i + 1) % 6}`, g + 1, "1-2", 100));
  }
  const res = computeSeasonRatings(rows);
  for (const r of res) assert(r.offensiveRating == null, `zero-variance offense null for ${r.personRef}`);
})();

// ---------- 3) score-only offensive rating and Score-based badge ----------
(function scoreOnly() {
  const rows: RatingGame[] = [];
  // 6 bowlers, 9 games each, varied scores, no frames
  const skill = [80, 90, 100, 110, 120, 130];
  for (let i = 0; i < 6; i++) {
    for (let g = 0; g < 9; g++) {
      rows.push(scoreGame(`p${i}`, `p${(i + 1) % 6}`, 1 + Math.floor(g / 3), `${g}-${g+1}`, skill[i] + (g % 3) * 5));
    }
  }
  const res = computeSeasonRatings(rows);
  const top = res.find((r) => r.personRef === "p5")!;
  const bot = res.find((r) => r.personRef === "p0")!;
  assert(top.offensiveRating != null && bot.offensiveRating != null, "both have score-only ratings");
  assert(top.offensiveRating! > 100, "top scorer above 100");
  assert(bot.offensiveRating! < 100, "bottom scorer below 100");
  assert(top.quality === "Score-based" || top.quality === "Limited sample", "quality is score-based or limited");
  // 9 games meets Full sample threshold; but no frames → Score-based
  assert(top.quality === "Score-based", "9 actual games & no frames → Score-based");
})();

// ---------- 4) full-linescore inclusion and reweighting ----------
(function fullLinescore() {
  const rows: RatingGame[] = [];
  // 6 bowlers, 9 full games. p5 dominates.
  for (let i = 0; i < 6; i++) {
    for (let g = 0; g < 9; g++) {
      const s = 100 + i * 10;
      rows.push(scoreGame(`p${i}`, `p${(i + 1) % 6}`, 1 + Math.floor(g / 3), `${g}-${g+1}`, s,
        null, fullFrame(2 + i, 3, 5 - i, 1 + Math.floor(i / 3))));
    }
  }
  const res = computeSeasonRatings(rows);
  const top = res.find((r) => r.personRef === "p5")!;
  assert(top.quality === "Full", "≥9 games with frames → Full");
  assert(top.details.strikePct != null && top.details.openPct != null, "frame details populated");
})();

// ---------- 5) substitute personal attribution ----------
(function subAttribution() {
  // Two bowlers p1, p2 playing head-to-head. In one match, sub 'subX' rolls for p1.
  // The substitute's personal offense must accrue to 'subX', not 'p1'.
  const rows: RatingGame[] = [];
  for (let w = 1; w <= 3; w++) {
    rows.push(scoreGame("p1", "p2", w, "1-2", 100));
    rows.push(scoreGame("p1", "p2", w, "1-2", 100));
    rows.push(scoreGame("p1", "p2", w, "1-2", 100));
    rows.push(scoreGame("p2", "p1", w, "1-2", 100));
    rows.push(scoreGame("p2", "p1", w, "1-2", 100));
    rows.push(scoreGame("p2", "p1", w, "1-2", 100));
  }
  // Week 4: sub rolls for p1, scoring 190 each game. p2 opponent is p2.
  for (let g = 0; g < 3; g++) {
    rows.push(scoreGame("subX", "p2", 4, "3-4", 190));
    rows.push(scoreGame("p2", "subX", 4, "3-4", 110));
  }
  const res = computeSeasonRatings(rows);
  const p1 = res.find((r) => r.personRef === "p1")!;
  const sub = res.find((r) => r.personRef === "subX")!;
  assert(p1.details.actualGames === 9, "p1 keeps 9 personal games (weeks 1-3 only)");
  assert(sub.details.actualGames === 3, "sub receives 3 personal games");
})();

// ---------- 6) absent synthetic scores excluded (extractor concern) ----------
// Enforced at extract time by projectSide; direct module test: rows never
// contain absent-side entries. See ratings-extract.ts.

// ---------- 7) opponent LOO baseline + entry-average fallback + season-mean ----------
(function looBaseline() {
  // p1 faces p2 (weak) and p3 (strong). p3's non-p1 games avg 200,
  // vs p1 they scored 150. Expected suppression for p1 is positive.
  const rows: RatingGame[] = [];
  // p3 vs others 6 games at 200 (env-adjusted)
  for (let w = 1; w <= 2; w++) {
    for (let g = 0; g < 3; g++) {
      rows.push(scoreGame("p3", "p4", w, "5-6", 200));
      rows.push(scoreGame("p4", "p3", w, "5-6", 150));
    }
  }
  // p1 vs p3 at week 3 — p3 scored only 150 (suppressed)
  for (let g = 0; g < 3; g++) {
    rows.push(scoreGame("p3", "p1", 3, "1-2", 150));
    rows.push(scoreGame("p1", "p3", 3, "1-2", 150));
  }
  // Filler for pool eligibility
  for (let i = 5; i < 12; i++) {
    for (let g = 0; g < 3; g++) {
      rows.push(scoreGame(`f${i}`, `f${i + 1}`, 1 + (g % 3), "7-8", 150));
      rows.push(scoreGame(`f${i + 1}`, `f${i}`, 1 + (g % 3), "7-8", 150));
    }
  }
  const res = computeSeasonRatings(rows);
  const p1 = res.find((r) => r.personRef === "p1");
  assert(p1?.details.opponentScoreSuppressionPerGame != null, "p1 has defense sample");
  assert(p1!.details.opponentScoreSuppressionPerGame! > 0, "positive suppression when opp underperforms LOO baseline");
})();

// ---------- 8) reliability shrinkage + 50-150 cap ----------
(function shrinkAndCap() {
  assert(shrinkZ(4, 3) < 4, "shrink pulls toward 0 for small n");
  assert(approx(shrinkZ(1, 9), 0.5), "n=9 shrinks by 0.5 exactly");
  assert(zToRating(-10) === 50, "cap floor 50");
  assert(zToRating(10) === 150, "cap ceiling 150");
  assert(zToRating(0) === 100, "z=0 → 100");
})();

// ---------- 9) two-way 70/30 ----------
(function twoWayMath() {
  assert(twoWay(120, 100) === 114, "0.7*120+0.3*100 = 114");
  assert(twoWay(120, null) == null, "unavailable defense → two-way null");
  assert(twoWay(null, 120) == null, "unavailable offense → two-way null");
})();

// ---------- 10) career game-weighted, season-normalized ----------
(function career() {
  const c = computeCareerRatings("pp", [
    { seasonId: "2025", offense: 120, defense: 110, actualGames: 20, opponentGames: 20, fullLinescoreGames: 20 },
    { seasonId: "2024", offense: 100, defense: null, actualGames: 10, opponentGames: 10, fullLinescoreGames: 0 },
  ]);
  // offense = (120*20 + 100*10)/30 = (2400+1000)/30 = 113.333 → 113.3
  assert(c.offensiveRating === 113.3, "career offense weighted");
  assert(c.matchupDefense === 110, "defense only counts seasons with defense value");
  assert(c.twoWayRating === twoWay(113.3, 110), "career two-way");
})();

// ---------- 11) leaderboard thresholds and stable ties ----------
(function boards() {
  const entries = [
    { personRef: "A", displayName: "Alpha", offensiveRating: 120, matchupDefense: 100, twoWayRating: 114,
      quality: "Full" as const, details: { actualGames: 6, opponentGames: 6, fullLinescoreGames: 6,
      adjustedAverage: null, adjustedPinsPerGameVsLeague: null, strikePct: null, spareConversionPct: null,
      openPct: null, clutchPct: null, opponentScoreSuppressionPerGame: null, opponentStrikeSuppressionPct: null,
      opponentSpareConversionSuppressionPct: null, opponentOpenIncreasePct: null, opponentClutchSuppressionPct: null } },
    { personRef: "B", displayName: "Bravo", offensiveRating: 120, matchupDefense: 100, twoWayRating: 114,
      quality: "Full" as const, details: { actualGames: 10, opponentGames: 10, fullLinescoreGames: 10,
      adjustedAverage: null, adjustedPinsPerGameVsLeague: null, strikePct: null, spareConversionPct: null,
      openPct: null, clutchPct: null, opponentScoreSuppressionPerGame: null, opponentStrikeSuppressionPct: null,
      opponentSpareConversionSuppressionPct: null, opponentOpenIncreasePct: null, opponentClutchSuppressionPct: null } },
    { personRef: "C", displayName: "Charlie", offensiveRating: 90, matchupDefense: 90, twoWayRating: 90,
      quality: "Full" as const, details: { actualGames: 3, opponentGames: 3, fullLinescoreGames: 3,
      adjustedAverage: null, adjustedPinsPerGameVsLeague: null, strikePct: null, spareConversionPct: null,
      openPct: null, clutchPct: null, opponentScoreSuppressionPerGame: null, opponentStrikeSuppressionPct: null,
      opponentSpareConversionSuppressionPct: null, opponentOpenIncreasePct: null, opponentClutchSuppressionPct: null } },
  ];
  const off = leaderboardOffense(entries);
  assert(off.length === 2 && off[0].personRef === "B", "larger sample tiebreak wins");
  const def = leaderboardDefense(entries);
  assert(def.length === 2, "excludes <6 opponent games");
  const tw = leaderboardTwoWay(entries);
  assert(tw.length === 2 && tw[0].personRef === "B", "two-way tiebreak by min sample size");
})();

// ---------- 12) source-level regression: current 2026 standings paths unmodified ----------
(function sourceRegression() {
  const buildSnapshot = readFileSync("src/lib/snapshot-builder.server.ts", "utf-8");
  assert(!/ratings\.ts/.test(buildSnapshot) && !/from ["']\.\/ratings/.test(buildSnapshot),
    "snapshot-builder.server.ts must not import the experimental ratings module");
  const mock = readFileSync("src/lib/mock-data.ts", "utf-8");
  assert(!/from ["']\.\/ratings["']/.test(mock),
    "mock-data.ts must not import ratings module");
  const rr = readFileSync("src/lib/season-history.ts", "utf-8");
  assert(!/from ["']\.\/ratings["']/.test(rr),
    "season-history.ts must not import ratings module");
})();

// ---------- 13) sanity: popStdev / mean ----------
(function statsHelpers() {
  assert(approx(popStdev([1, 1, 1]), 0), "zero variance");
  assert(approx(popStdev([0, 10]), 5), "population stdev for [0,10]");
})();

// ---------- 14) extractor: score-only substitute attribution + published gate ----------
(async function extractor() {
  const { ratingGamesFromCurrentSeason } = await import("../src/lib/ratings-extract");
  // Minimal MatchResult-like shape. Score-only match, substitute "subZ" rolled
  // for scheduled "sched1" (linescoreA is null in score-only mode).
  const mkMatch = (week: number, status: "completed" | "scheduled", opts: {
    subA?: boolean; absentA?: boolean;
  } = {}) => ({
    id: `m-${week}`, week, lanePair: "1-2" as const, slot: 1, status,
    bowlerA: "sched1", bowlerB: "sched2",
    result: status === "completed" ? {
      scheduledA: "sched1", scheduledB: "sched2",
      scheduledNameA: "S1", scheduledNameB: "S2",
      actualA: opts.subA ? "subZ" : "sched1",
      actualB: "sched2",
      actualNameA: opts.subA ? "Sub Z" : "S1", actualNameB: "S2",
      isSubA: !!opts.subA, isSubB: false,
      participationA: {
        scheduledId: "sched1",
        status: opts.absentA ? "absent" : (opts.subA ? "substitute" : "rostered"),
        actualId: opts.absentA ? null : (opts.subA ? "subZ" : "sched1"),
        actualName: opts.subA ? "Sub Z" : "S1",
      },
      participationB: {
        scheduledId: "sched2", status: "rostered",
        actualId: "sched2", actualName: "S2",
      },
      entryAverageA: 120, entryAverageB: 120, handicapA: 0, handicapB: 0,
      linescoreA: null, linescoreB: null,
      gamesA: [180, 180, 180] as [number, number, number],
      gamesB: [100, 100, 100] as [number, number, number],
      handicapGamesA: [180,180,180], handicapGamesB: [100,100,100],
      scratchTotalA: 540, scratchTotalB: 300,
      handicapTotalA: 540, handicapTotalB: 300,
      gameAwardsA: [2,2,2] as [0|1|2,0|1|2,0|1|2],
      gameAwardsB: [0,0,0] as [0|1|2,0|1|2,0|1|2],
      gamePointsA: 6, gamePointsB: 0,
      setPointA: 1 as 0|0.5|1, setPointB: 0 as 0|0.5|1,
      totalPointsA: 7, totalPointsB: 0,
      pointsOverride: null, winner: "A" as const,
      scoreOnly: true, completedGameCount: 3 as 0|1|2|3,
      pairCompleted: [true, true, true] as [boolean, boolean, boolean],
    } : undefined,
  });

  // Substitute in a score-only completed match should attribute personal
  // rows to subZ, never to sched1.
  const wk1 = [mkMatch(1, "completed", { subA: true })];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowsA = ratingGamesFromCurrentSeason("S", { 1: wk1 as any });
  assert(rowsA.some((r) => r.personRef === "subZ"), "sub personal row emitted");
  assert(!rowsA.some((r) => r.personRef === "sched1"),
    "score-only sub row must NOT be attributed to scheduled rostered bowler");

  // Published-week filter: an unpublished week 2 must be skipped.
  const wk2 = [mkMatch(2, "completed")];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowsB = ratingGamesFromCurrentSeason("S", { 1: wk1 as any, 2: wk2 as any },
    new Set<number>([1]));
  assert(rowsB.every((r) => r.weekNumber === 1), "unpublished week filtered out");

  // Absent side: no rows for the absent participant.
  const wk3 = [mkMatch(3, "completed", { absentA: true })];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rowsC = ratingGamesFromCurrentSeason("S", { 3: wk3 as any });
  assert(!rowsC.some((r) => r.personRef === "sched1"),
    "absent side must not emit personal rows");
})();

// ---------- audit-corrections regressions ----------

// combineAliasRatings: two aliases with different sample sizes get
// game-weighted correctly and sample counts sum exactly once.
(function combineAliases() {
  const aliases: BowlerRatings[] = [
    {
      personRef: "roster-x", offensiveRating: 110, matchupDefense: 105, twoWayRating: 108,
      details: { actualGames: 15, opponentGames: 15, fullLinescoreGames: 15,
        actualZ: 0, opponentZ: 0, offenseShrunkZ: 0, defenseShrunkZ: 0,
        components: {} as never, opponentComponents: {} as never },
    } as unknown as BowlerRatings,
    {
      personRef: "sub-x", offensiveRating: 90, matchupDefense: 95, twoWayRating: 92,
      details: { actualGames: 3, opponentGames: 3, fullLinescoreGames: 0,
        actualZ: 0, opponentZ: 0, offenseShrunkZ: 0, defenseShrunkZ: 0,
        components: {} as never, opponentComponents: {} as never },
    } as unknown as BowlerRatings,
  ];
  const c = combineAliasRatings(aliases);
  assert(c != null, "combined result exists");
  assert(c!.actualGames === 18, "actualGames summed once");
  assert(c!.opponentGames === 18, "opponentGames summed once");
  assert(c!.fullLinescoreGames === 15, "full linescore games summed once");
  // Offense weighted mean = (110*15 + 90*3)/18 = (1650+270)/18 = 106.66..
  assert(approx(c!.offense!, Number(((110 * 15 + 90 * 3) / 18).toFixed(1)), 1e-9),
    "offense actual-game weighted");
  assert(approx(c!.defense!, Number(((105 * 15 + 95 * 3) / 18).toFixed(1)), 1e-9),
    "defense opponent-game weighted");

  // Null propagation: no alias has a rating → null returned for that axis.
  const nulls = combineAliasRatings([
    { personRef: "a", offensiveRating: null, matchupDefense: null, twoWayRating: null,
      details: { actualGames: 5, opponentGames: 5, fullLinescoreGames: 0 } } as unknown as BowlerRatings,
  ]);
  assert(nulls != null && nulls.offense === null && nulls.defense === null,
    "null ratings propagate when no alias provides them");

  assert(combineAliasRatings([]) === null, "empty aliases -> null");
})();

// careerRatingQuality: sample thresholds and evidence gates.
(function careerQuality() {
  // Not enough games -> Limited sample
  const limited = { totals: { actualGames: 5, opponentGames: 5,
    fullLinescoreGames: 0, seasonsOffense: 1, seasonsDefense: 1 } } as never;
  assert(careerRatingQuality(limited) === "Limited sample",
    "small career sample => Limited sample");
  // Eligible but no frame linescore -> Score-based
  const scoreOnly = { totals: { actualGames: 40, opponentGames: 40,
    fullLinescoreGames: 0, seasonsOffense: 2, seasonsDefense: 2 } } as never;
  assert(careerRatingQuality(scoreOnly) === "Score-based",
    "eligible career, no frames => Score-based");
  // Eligible + rich frame linescore -> Full
  const full = { totals: { actualGames: 60, opponentGames: 60,
    fullLinescoreGames: 30, seasonsOffense: 2, seasonsDefense: 2 } } as never;
  assert(careerRatingQuality(full) === "Full",
    "eligible frame-rich career => Full");
})();

// Canonical clutch marks override any conflicting naive interpretation:
// pass a linescore game with a deliberately misleading marks string and
// verify frameStatsFromLinescore reads segments.clutchMarks.
(function canonicalClutch() {
  // Build a minimal GameLinescore-shaped input.
  const rolls = Array.from({ length: 10 }, () => [0, 0] as [number, number]);
  const g = {
    rolls,
    frameScores: Array(10).fill(0),
    total: 0,
    segments: {
      firstFive: 0, lastFive: 0,
      strikes: 0, spares: 0, opens: 0,
      cleanFrames: 0, marks: 0,
      // deliberately conflict: naive count of "X"/"/" in a made-up mark
      // string would be 3, but canonical segments.clutchMarks is 1.
      clutchMarks: 1, clutchOpportunities: 2,
      pinsLeftOnOpens: 0, isCleanGame: false,
      marksString: "X/X",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f = frameStatsFromLinescore(g as any);
  assert(f.clutchMarks === 1 && f.clutchOpportunities === 2,
    "frame stats read canonical clutchMarks, not marksString");
})();

// Source-level regression: public rating routes must import
// useCurrentPublicSnapshot (from public-snapshot) and must NOT read
// useLeagueSnapshot as their rating data source.
(function ratingsSnapshotSource() {
  const routes = [
    "src/routes/bowlers.$bowlerId.tsx",
    "src/routes/bowlers.sub.$substituteId.tsx",
    "src/routes/statistics.tsx",
    "src/routes/people.$personId.tsx",
  ];
  for (const path of routes) {
    const src = readFileSync(path, "utf8");
    assert(src.includes("useCurrentPublicSnapshot"),
      `${path} must import useCurrentPublicSnapshot`);
    assert(!/useLeagueSnapshot\s*\(/.test(src),
      `${path} must not call useLeagueSnapshot() for rating data`);
    assert(!src.includes('from "@/lib/league-store"'),
      `${path} must not import from league-store`);
  }
})();

// Hook-order regression for archived per-bowler route: no React hook may
// appear textually AFTER the first conditional early return.
(function archivedHookOrder() {
  const path = "src/routes/seasons.$seasonId.bowlers.$participantRef.tsx";
  const src = readFileSync(path, "utf8");
  const fnStart = src.indexOf("function SeasonBowlerPage");
  assert(fnStart > 0, "SeasonBowlerPage function found");
  const body = src.slice(fnStart);
  const firstReturn = body.search(/^\s*if\s*\([^\n]+\)\s*return/m);
  assert(firstReturn > 0, "first conditional return found");
  const afterReturn = body.slice(firstReturn);
  assert(!/\buseMemo\s*\(/.test(afterReturn) &&
         !/\buseState\s*\(/.test(afterReturn) &&
         !/\buseQuery\s*\(/.test(afterReturn),
    "no hooks may appear after the first conditional return");
})();

// Ratings math must not leak into scoring/snapshot/mock-data modules.
(function ratingsIsolation() {
  for (const path of [
    "src/lib/snapshot-builder.server.ts",
    "src/lib/mock-data.ts",
    "src/lib/live-scoring.ts",
    "src/lib/standings-rank.ts",
  ]) {
    const src = readFileSync(path, "utf8");
    assert(!src.includes('from "@/lib/ratings"') && !src.includes("from './ratings'") && !src.includes('from "./ratings"'),
      `${path} must not import from ratings`);
  }
})();

// eslint-disable-next-line no-console
console.log("ratings tests passed");

