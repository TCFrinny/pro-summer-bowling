/**
 * All-Time Leaderboards — pure per-season contribution builders.
 *
 * NO Supabase, NO globals. Called from `leaderboards-repo.functions.ts` on
 * the server and directly from tests. Every current-season aggregate is
 * derived from PUBLISHED `matchesByWeek` only — never from
 * `bowlersById.actualGamesRolled`, `substituteProfiles.gamesRolled`, or
 * `snapshot.history`, all of which include unpublished weeks.
 */

import {
  getAwardedPoints,
  type BowlerId,
  type Match,
  type MatchResult,
  type PublicSnapshot,
} from "./mock-data";
import type { GameLinescore } from "./duckpin";
import {
  extractCurrentRosterRecordContribution,
  extractCurrentSubstituteRecordContribution,
  extractHistoricalRecordContribution,
} from "./career-records";
import {
  ratingGamesFromCurrentSeason,
  ratingGamesFromHistoricalSnapshot,
} from "./ratings-extract";
import {
  combineAliasRatings,
  computeSeasonRatings,
  type BowlerRatings,
} from "./ratings";
import {
  deriveHistoricalChampion,
  type HistoricalSnapshot,
} from "./historical-snapshot";
import {
  LeaderboardIdentityKind,
  type LeaderboardIdentity,
  type SeasonContribution,
} from "./leaderboards";

// ---------------------------------------------------------------------------
// Identity constructors — carry the correct href kind for public routing
// ---------------------------------------------------------------------------

export function idPerson(personId: string, displayName: string): LeaderboardIdentity {
  return {
    key: `person:${personId}`,
    displayName,
    personId,
    unlinkedSeasonId: null,
    unlinkedParticipantRef: null,
    hrefKind: LeaderboardIdentityKind.Person,
  };
}
export function idCurrentRoster(rosterId: string, displayName: string): LeaderboardIdentity {
  return {
    key: `current-roster:${rosterId}`,
    displayName,
    personId: null,
    unlinkedSeasonId: null,
    unlinkedParticipantRef: rosterId,
    hrefKind: LeaderboardIdentityKind.CurrentRoster,
  };
}
export function idCurrentSub(subId: string, displayName: string): LeaderboardIdentity {
  return {
    key: `current-sub:${subId}`,
    displayName,
    personId: null,
    unlinkedSeasonId: null,
    unlinkedParticipantRef: subId,
    hrefKind: LeaderboardIdentityKind.CurrentSub,
  };
}
export function idHistorical(
  seasonId: string,
  participantRef: string,
  displayName: string,
): LeaderboardIdentity {
  return {
    key: `historical:${seasonId}:${participantRef}`,
    displayName,
    personId: null,
    unlinkedSeasonId: seasonId,
    unlinkedParticipantRef: participantRef,
    hrefKind: LeaderboardIdentityKind.Historical,
  };
}

function emptyContribution(identity: LeaderboardIdentity): SeasonContribution {
  return {
    identityKey: identity.key,
    identity,
    championship: false,
    gameWins: 0, setWins: 0, overallWins: 0,
    games: 0, scratchPinfall: 0,
    highGame: null, highSet: null,
    poaSum: null, poaGames: null,
    strikes: null, spares: null, opens: null,
    framesRolled: null, openPinsLeft: null,
    clutchMarks: null, clutchOpportunities: null,
    offense: null, defense: null,
    actualRatingGames: 0, opponentRatingGames: 0, fullLinescoreGames: 0,
  };
}

// ---------------------------------------------------------------------------
// Personal / roster-credit aggregate walked from PUBLISHED matches only
// ---------------------------------------------------------------------------

interface PersonalAgg {
  games: number;
  scratchPinfall: number;
  highGame: number | null;
  highSet: number | null;
  poaSum: number;
  poaGames: number;
  framesRolled: number;
  strikes: number;
  spares: number;
  opens: number;
  openPinsLeft: number;
  clutchMarks: number;
  clutchOpportunities: number;
  hasFrames: boolean;
  overallWins: number;
  overallHasCredit: boolean;
}
function emptyPersonal(): PersonalAgg {
  return {
    games: 0, scratchPinfall: 0, highGame: null, highSet: null,
    poaSum: 0, poaGames: 0,
    framesRolled: 0, strikes: 0, spares: 0, opens: 0, openPinsLeft: 0,
    clutchMarks: 0, clutchOpportunities: 0, hasFrames: false,
    overallWins: 0, overallHasCredit: false,
  };
}

export interface CurrentPublishedAggregates {
  roster: Map<BowlerId, PersonalAgg>;
  sub: Map<BowlerId, PersonalAgg>;
}

/** Walk every published & completed match. Personal counters attribute to
 *  the ACTUAL bowler (rostered self OR substitute); overall roster-credit
 *  points attribute to the SCHEDULED rostered bowler regardless of who
 *  rolled. Absent sides never contribute personal counters. */
export function buildCurrentPublishedAggregates(
  snapshot: PublicSnapshot,
  publishedWeeks: ReadonlySet<number>,
): CurrentPublishedAggregates {
  const roster = new Map<BowlerId, PersonalAgg>();
  const sub = new Map<BowlerId, PersonalAgg>();
  const ensure = (m: Map<string, PersonalAgg>, k: string): PersonalAgg => {
    let a = m.get(k);
    if (!a) { a = emptyPersonal(); m.set(k, a); }
    return a;
  };
  for (const [wkStr, matches] of Object.entries(snapshot.matchesByWeek ?? {}) as Array<[string, Match[]]>) {
    const wk = Number(wkStr);
    if (!publishedWeeks.has(wk)) continue;
    for (const m of matches) {
      if (m.status !== "completed" || !m.result) continue;
      const r: MatchResult = m.result;
      const award = getAwardedPoints(r);
      for (const side of ["A", "B"] as const) {
        const part = side === "A" ? r.participationA : r.participationB;
        const scheduledId = side === "A" ? r.scheduledA : r.scheduledB;

        // Overall roster credit — always credited to the SCHEDULED rostered
        // bowler, from published-match awarded points (respects override).
        const pts = side === "A" ? award.pointsA : award.pointsB;
        if (typeof pts === "number" && Number.isFinite(pts)) {
          const rosterAgg = ensure(roster, scheduledId);
          rosterAgg.overallWins += pts;
          rosterAgg.overallHasCredit = true;
        }

        // Personal only when the side actually rolled.
        if (part.status === "absent") continue;
        const isSub = part.status === "substitute";
        const actualId = isSub ? (part.actualId ?? "") : scheduledId;
        if (!actualId) continue;
        const agg = ensure(isSub ? sub : roster, actualId);

        const linescore = side === "A" ? r.linescoreA : r.linescoreB;
        const scratchGames = side === "A" ? r.gamesA : r.gamesB;
        const mask: [boolean, boolean, boolean] =
          r.scoreOnly && r.pairCompleted ? r.pairCompleted : [true, true, true];
        const entryAvg = linescore?.entryAverage ??
          (side === "A" ? r.entryAverageA : r.entryAverageB);

        if (linescore && !r.scoreOnly) {
          const games = linescore.games;
          let setSum = 0;
          for (const g of games as readonly GameLinescore[]) {
            agg.games += 1;
            agg.scratchPinfall += g.scratchTotal;
            agg.highGame = Math.max(agg.highGame ?? 0, g.scratchTotal);
            if (typeof entryAvg === "number") {
              agg.poaSum += g.scratchTotal - entryAvg;
              agg.poaGames += 1;
            }
            agg.framesRolled += 10;
            agg.strikes += g.strikes;
            agg.spares += g.spares;
            agg.opens += g.opens;
            agg.openPinsLeft += g.openPinsLeft;
            agg.clutchMarks += g.segments.clutchMarks;
            agg.clutchOpportunities += 2;
            agg.hasFrames = true;
            setSum += g.scratchTotal;
          }
          agg.highSet = Math.max(agg.highSet ?? 0, setSum);
        } else {
          let played = 0, setSum = 0;
          for (let i = 0; i < 3; i++) {
            if (!mask[i]) continue;
            const s = scratchGames[i];
            if (typeof s !== "number") continue;
            agg.games += 1;
            agg.scratchPinfall += s;
            agg.highGame = Math.max(agg.highGame ?? 0, s);
            if (typeof entryAvg === "number") {
              agg.poaSum += s - entryAvg;
              agg.poaGames += 1;
            }
            played += 1;
            setSum += s;
          }
          if (played === 3) agg.highSet = Math.max(agg.highSet ?? 0, setSum);
        }
      }
    }
  }
  return { roster, sub };
}

// ---------------------------------------------------------------------------
// Current-season contribution builder
// ---------------------------------------------------------------------------

export interface CurrentSeasonInput {
  seasonId: string;
  championPersonId: string | null;
  snapshot: PublicSnapshot;
}

export function buildCurrentSeasonContribs(input: CurrentSeasonInput): SeasonContribution[] {
  const { seasonId, championPersonId, snapshot } = input;
  const publishedWeeks = new Set<number>(
    (snapshot.weeks ?? []).filter((w) => w.published).map((w) => w.week),
  );
  const { roster: rosterAgg, sub: subAgg } = buildCurrentPublishedAggregates(snapshot, publishedWeeks);

  // Ratings — restrict to published weeks.
  const ratingRows = ratingGamesFromCurrentSeason(seasonId, snapshot.matchesByWeek, publishedWeeks);
  const seasonRatings = computeSeasonRatings(ratingRows);
  const ratingByRef = new Map(seasonRatings.map((r) => [r.personRef, r]));

  const contribByKey = new Map<string, SeasonContribution>();
  const aliasesByKey = new Map<string, BowlerRatings[]>();
  const ensure = (identity: LeaderboardIdentity): SeasonContribution => {
    let c = contribByKey.get(identity.key);
    if (!c) { c = emptyContribution(identity); contribByKey.set(identity.key, c); }
    return c;
  };
  const addAlias = (key: string, r: BowlerRatings | undefined) => {
    if (!r) return;
    const arr = aliasesByKey.get(key) ?? [];
    arr.push(r);
    aliasesByKey.set(key, arr);
  };

  const foldPersonal = (c: SeasonContribution, agg: PersonalAgg | undefined): void => {
    if (!agg) return;
    c.games += agg.games;
    c.scratchPinfall += agg.scratchPinfall;
    if (agg.highGame != null) c.highGame = Math.max(c.highGame ?? 0, agg.highGame);
    if (agg.highSet != null) c.highSet = Math.max(c.highSet ?? 0, agg.highSet);
    if (agg.poaGames > 0) {
      c.poaSum = (c.poaSum ?? 0) + agg.poaSum;
      c.poaGames = (c.poaGames ?? 0) + agg.poaGames;
    }
    if (agg.hasFrames) {
      c.framesRolled = (c.framesRolled ?? 0) + agg.framesRolled;
      c.strikes = (c.strikes ?? 0) + agg.strikes;
      c.spares = (c.spares ?? 0) + agg.spares;
      c.opens = (c.opens ?? 0) + agg.opens;
      c.openPinsLeft = (c.openPinsLeft ?? 0) + agg.openPinsLeft;
      c.clutchMarks = (c.clutchMarks ?? 0) + agg.clutchMarks;
      c.clutchOpportunities = (c.clutchOpportunities ?? 0) + agg.clutchOpportunities;
    }
  };

  for (const b of snapshot.bowlers ?? []) {
    const identity = b.personId
      ? idPerson(b.personId, b.name)
      : idCurrentRoster(b.id, b.name);
    const c = ensure(identity);
    foldPersonal(c, rosterAgg.get(b.id));
    // Record (personal + overall-from-roster-credit).
    const rec = extractCurrentRosterRecordContribution(snapshot, b.id, publishedWeeks, seasonId);
    c.gameWins += rec.gameW ?? 0;
    c.setWins += rec.setW ?? 0;
    // Overall wins from PUBLISHED matches (not bowlersById.points, which
    // may include unpublished-week aggregation).
    const rc = rosterAgg.get(b.id);
    if (rc?.overallHasCredit) c.overallWins += rc.overallWins;
    addAlias(identity.key, ratingByRef.get(b.id));
  }
  for (const s of snapshot.substitutes ?? []) {
    const identity = s.personId
      ? idPerson(s.personId, s.name)
      : idCurrentSub(s.id, s.name);
    const c = ensure(identity);
    foldPersonal(c, subAgg.get(s.id));
    const rec = extractCurrentSubstituteRecordContribution(snapshot, s.id, publishedWeeks, seasonId);
    c.gameWins += rec.gameW ?? 0;
    c.setWins += rec.setW ?? 0;
    addAlias(identity.key, ratingByRef.get(s.id));
  }

  if (championPersonId) {
    const key = `person:${championPersonId}`;
    const c = contribByKey.get(key);
    if (c) c.championship = true;
  }

  for (const [key, aliases] of aliasesByKey.entries()) {
    const c = contribByKey.get(key);
    if (!c) continue;
    const combined = combineAliasRatings(aliases);
    if (combined) {
      c.offense = combined.offense;
      c.defense = combined.defense;
      c.actualRatingGames = combined.actualGames;
      c.opponentRatingGames = combined.opponentGames;
      c.fullLinescoreGames = combined.fullLinescoreGames;
    }
  }
  return Array.from(contribByKey.values());
}

// ---------------------------------------------------------------------------
// Historical-season contribution builder
// ---------------------------------------------------------------------------

export function buildHistoricalSeasonContribs(
  seasonId: string,
  snap: HistoricalSnapshot,
): SeasonContribution[] {
  const champion = deriveHistoricalChampion(snap);
  const ratingRows = ratingGamesFromHistoricalSnapshot(snap);
  const seasonRatings = computeSeasonRatings(ratingRows);
  const ratingByRef = new Map(seasonRatings.map((r) => [r.personRef, r]));

  const contribByKey = new Map<string, SeasonContribution>();
  const aliasesByKey = new Map<string, BowlerRatings[]>();
  const ensure = (identity: LeaderboardIdentity): SeasonContribution => {
    let c = contribByKey.get(identity.key);
    if (!c) { c = emptyContribution(identity); contribByKey.set(identity.key, c); }
    return c;
  };
  const addAlias = (key: string, r: BowlerRatings | undefined) => {
    if (!r) return;
    const arr = aliasesByKey.get(key) ?? [];
    arr.push(r);
    aliasesByKey.set(key, arr);
  };

  for (const p of snap.participants ?? []) {
    const identity = p.personId
      ? idPerson(p.personId, p.displayName)
      : idHistorical(seasonId, p.ref, p.displayName);
    const c = ensure(identity);
    const stat = (snap.participantStats ?? []).find((s) => s.participantRef === p.ref);
    const standing = (snap.standings ?? []).find((s) => s.participantRef === p.ref);
    const games = stat?.games ?? standing?.games ?? null;
    const pinfall = stat?.scratchPinfall ?? standing?.scratchPinfall ?? null;
    const hg = stat?.highGame ?? standing?.highGame ?? null;
    const hs = stat?.highSet ?? standing?.highSet ?? null;
    if (games != null) c.games += games;
    if (pinfall != null) c.scratchPinfall += pinfall;
    if (hg != null) c.highGame = Math.max(c.highGame ?? 0, hg);
    if (hs != null) c.highSet = Math.max(c.highSet ?? 0, hs);
    const rec = extractHistoricalRecordContribution({
      seasonId, role: p.role, participantRef: p.ref,
      weeks: snap.weeks, standings: snap.standings,
    });
    c.gameWins += rec.gameW ?? 0;
    c.setWins += rec.setW ?? 0;
    c.overallWins += rec.pointsWon ?? 0;
    // Advanced totals (frame-derived). Loader-provided snapshot has been
    // filtered to published weeks, so participantStats already reflects
    // only published data.
    const adv = stat?.advanced;
    if (adv) {
      c.framesRolled = (c.framesRolled ?? 0) + adv.framesRolled;
      c.strikes = (c.strikes ?? 0) + adv.strikes;
      c.spares = (c.spares ?? 0) + adv.spares;
      c.opens = (c.opens ?? 0) + adv.opens;
      c.openPinsLeft = (c.openPinsLeft ?? 0) + adv.openPinsLeft;
      c.clutchMarks = (c.clutchMarks ?? 0) + adv.clutchMarks;
      c.clutchOpportunities = (c.clutchOpportunities ?? 0) + adv.clutchOpportunities;
    }
    if (stat && stat.seasonPOA != null && stat.games != null && stat.games > 0) {
      c.poaSum = (c.poaSum ?? 0) + stat.seasonPOA * stat.games;
      c.poaGames = (c.poaGames ?? 0) + stat.games;
    }
    if (champion && champion.participantRef === p.ref) c.championship = true;
    addAlias(identity.key, ratingByRef.get(p.ref));
  }

  for (const s of snap.summaryRecords ?? []) {
    if ((snap.participants ?? []).some((p) => p.ref === s.participantRef)) continue;
    const identity = s.personId
      ? idPerson(s.personId, s.displayName)
      : idHistorical(seasonId, s.participantRef, s.displayName);
    const c = ensure(identity);
    if (s.games != null) c.games += s.games;
    if (s.scratchPinfall != null) c.scratchPinfall += s.scratchPinfall;
    if (s.highGame != null) c.highGame = Math.max(c.highGame ?? 0, s.highGame);
    if (s.highSet != null) c.highSet = Math.max(c.highSet ?? 0, s.highSet);
    if (s.role === "rostered" && s.points != null) c.overallWins += s.points;
    if (s.isChampion) c.championship = true;
  }

  for (const [key, aliases] of aliasesByKey.entries()) {
    const c = contribByKey.get(key);
    if (!c) continue;
    const combined = combineAliasRatings(aliases);
    if (combined) {
      c.offense = combined.offense;
      c.defense = combined.defense;
      c.actualRatingGames = combined.actualGames;
      c.opponentRatingGames = combined.opponentGames;
      c.fullLinescoreGames = combined.fullLinescoreGames;
    }
  }
  return Array.from(contribByKey.values());
}

// ---------------------------------------------------------------------------
// Season-visibility helper
// ---------------------------------------------------------------------------

export interface SeasonMetaLite {
  id: string;
  status: string;
  isCurrent: boolean;
  publicVisible: boolean;
}

/** Ids of historical seasons that are safe to read publicly:
 *  status === 'archived' AND public_visible === true. Current seasons and
 *  archived-but-private seasons are excluded. */
export function selectPublicHistoricalSeasonIds(
  seasons: readonly SeasonMetaLite[],
): string[] {
  return seasons
    .filter((s) => !s.isCurrent && s.status === "archived" && s.publicVisible)
    .map((s) => s.id);
}
