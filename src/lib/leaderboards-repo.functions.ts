/**
 * All-Time Leaderboards — server function.
 *
 * Reads:
 *   - The current-season `public_snapshots` row (already the public projection).
 *   - Every archived + public_visible historical_season_snapshot, run through
 *     `filterPublicHistoricalSnapshot()` before any aggregation.
 *
 * Returns only the derived numeric `AllTimeRow[]` — never a raw snapshot,
 * raw weeks, raw matches, or raw linescores. Anonymous SUPABASE clients
 * cannot read historical snapshots directly (RLS refuses), so the raw
 * source data never leaves the worker.
 */

import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  aggregateSeasonContributions,
  type AllTimeRow,
  type LeaderboardIdentity,
  type SeasonContribution,
} from "@/lib/leaderboards";
import type { PublicSnapshot } from "@/lib/mock-data";
import { computeSeasonRatings, combineAliasRatings } from "@/lib/ratings";
import {
  ratingGamesFromCurrentSeason,
  ratingGamesFromHistoricalSnapshot,
} from "@/lib/ratings-extract";
import {
  extractCurrentRosterRecordContribution,
  extractCurrentSubstituteRecordContribution,
  extractHistoricalRecordContribution,
} from "@/lib/career-records";
import {
  extractCurrentRosterAdvancedContribution,
  extractCurrentSubstituteAdvancedContribution,
  extractHistoricalAdvancedContribution,
} from "@/lib/career-advanced";
import {
  filterPublicHistoricalSnapshot,
  deriveHistoricalChampion,
  type HistoricalSnapshot,
} from "@/lib/historical-snapshot";

type Sb = SupabaseClient<Database>;
type LooseFrom = (t: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any

let _publicClient: Sb | undefined;
function makePublicClient(): Sb {
  if (_publicClient) return _publicClient;
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured");
  _publicClient = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (
          (key.startsWith("sb_publishable_") || key.startsWith("sb_secret_")) &&
          headers.get("Authorization") === `Bearer ${key}`
        ) {
          headers.delete("Authorization");
        }
        headers.set("apikey", key);
        return fetch(input, { ...init, headers });
      },
    },
  });
  return _publicClient;
}

// ---------------------------------------------------------------------------
// Contribution builders (server-only glue)
// ---------------------------------------------------------------------------

function idPerson(personId: string, displayName: string): LeaderboardIdentity {
  return {
    key: `person:${personId}`,
    displayName,
    personId,
    unlinkedSeasonId: null,
    unlinkedParticipantRef: null,
  };
}
function idUnlinked(seasonId: string, participantRef: string, displayName: string): LeaderboardIdentity {
  return {
    key: `unlinked:${seasonId}:${participantRef}`,
    displayName,
    personId: null,
    unlinkedSeasonId: seasonId,
    unlinkedParticipantRef: participantRef,
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

// ------- CURRENT SEASON -------

interface CurrentSeasonInput {
  seasonId: string;
  championPersonId: string | null;
  snapshot: PublicSnapshot;
}

function buildCurrentSeasonContribs(input: CurrentSeasonInput): SeasonContribution[] {
  const { seasonId, championPersonId, snapshot } = input;
  const publishedWeeks = new Set<number>(
    snapshot.weeks.filter((w) => w.published).map((w) => w.week),
  );

  // Ratings — compute per season, then group per identity via combineAliasRatings.
  const ratingRows = ratingGamesFromCurrentSeason(seasonId, snapshot.matchesByWeek, publishedWeeks);
  const seasonRatings = computeSeasonRatings(ratingRows);
  const ratingByRef = new Map(seasonRatings.map((r) => [r.personRef, r]));

  // Build one identity per Bowler / Substitute.
  const contribByKey = new Map<string, SeasonContribution>();
  const aliasesByKey = new Map<string, string[]>();

  const ensure = (identity: LeaderboardIdentity): SeasonContribution => {
    let c = contribByKey.get(identity.key);
    if (!c) { c = emptyContribution(identity); contribByKey.set(identity.key, c); }
    return c;
  };
  const addAlias = (key: string, ref: string) => {
    const arr = aliasesByKey.get(key) ?? [];
    arr.push(ref);
    aliasesByKey.set(key, arr);
  };

  for (const b of snapshot.bowlers) {
    const identity = b.personId
      ? idPerson(b.personId, b.name)
      : idUnlinked(seasonId, b.id, b.name);
    const c = ensure(identity);
    // Scoring
    c.games += b.actualGamesRolled;
    c.scratchPinfall += b.actualScratchPinfall;
    if (b.highGame > 0) c.highGame = Math.max(c.highGame ?? 0, b.highGame);
    if (b.highSet > 0) c.highSet = Math.max(c.highSet ?? 0, b.highSet);
    // Personal + overall record
    const rec = extractCurrentRosterRecordContribution(snapshot, b.id, publishedWeeks, seasonId);
    c.gameWins += rec.gameW ?? 0;
    c.setWins += rec.setW ?? 0;
    c.overallWins += rec.pointsWon ?? 0;
    // Frame + POA
    const adv = extractCurrentRosterAdvancedContribution(snapshot, b.id, seasonId);
    if (adv.framesRolled != null) {
      c.framesRolled = (c.framesRolled ?? 0) + (adv.framesRolled ?? 0);
      c.strikes = (c.strikes ?? 0) + (adv.strikes ?? 0);
      c.spares = (c.spares ?? 0) + (adv.spares ?? 0);
      c.opens = (c.opens ?? 0) + (adv.opens ?? 0);
      c.openPinsLeft = (c.openPinsLeft ?? 0) + (adv.openPinsLeft ?? 0);
      c.clutchMarks = (c.clutchMarks ?? 0) + (adv.clutchMarks ?? 0);
      c.clutchOpportunities = (c.clutchOpportunities ?? 0) + (adv.clutchOpportunities ?? 0);
    }
    if (adv.poaGames != null && adv.poaSum != null) {
      c.poaSum = (c.poaSum ?? 0) + adv.poaSum;
      c.poaGames = (c.poaGames ?? 0) + adv.poaGames;
    }
    addAlias(identity.key, b.id);
  }
  for (const s of snapshot.substitutes ?? []) {
    const profile = snapshot.substituteProfiles?.[s.id];
    if (!profile) continue;
    const identity = s.personId
      ? idPerson(s.personId, s.name)
      : idUnlinked(seasonId, s.id, s.name);
    const c = ensure(identity);
    c.games += profile.gamesRolled;
    c.scratchPinfall += profile.scratchPinfall;
    if (profile.highGame > 0) c.highGame = Math.max(c.highGame ?? 0, profile.highGame);
    if (profile.highSet > 0) c.highSet = Math.max(c.highSet ?? 0, profile.highSet);
    const rec = extractCurrentSubstituteRecordContribution(snapshot, s.id, publishedWeeks, seasonId);
    c.gameWins += rec.gameW ?? 0;
    c.setWins += rec.setW ?? 0;
    const adv = extractCurrentSubstituteAdvancedContribution(snapshot, s.id, seasonId);
    if (adv.framesRolled != null) {
      c.framesRolled = (c.framesRolled ?? 0) + (adv.framesRolled ?? 0);
      c.strikes = (c.strikes ?? 0) + (adv.strikes ?? 0);
      c.spares = (c.spares ?? 0) + (adv.spares ?? 0);
      c.opens = (c.opens ?? 0) + (adv.opens ?? 0);
      c.openPinsLeft = (c.openPinsLeft ?? 0) + (adv.openPinsLeft ?? 0);
      c.clutchMarks = (c.clutchMarks ?? 0) + (adv.clutchMarks ?? 0);
      c.clutchOpportunities = (c.clutchOpportunities ?? 0) + (adv.clutchOpportunities ?? 0);
    }
    if (adv.poaGames != null && adv.poaSum != null) {
      c.poaSum = (c.poaSum ?? 0) + adv.poaSum;
      c.poaGames = (c.poaGames ?? 0) + adv.poaGames;
    }
    addAlias(identity.key, s.id);
  }
  // Championship — current season only when a champion is set.
  if (championPersonId) {
    const key = `person:${championPersonId}`;
    const c = contribByKey.get(key);
    if (c) c.championship = true;
  }
  // Ratings per identity via alias combination.
  for (const [key, refs] of aliasesByKey.entries()) {
    const c = contribByKey.get(key);
    if (!c) continue;
    const alias = refs
      .map((ref) => ratingByRef.get(ref))
      .filter((x): x is NonNullable<typeof x> => !!x);
    const combined = combineAliasRatings(alias);
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

// ------- HISTORICAL SEASON -------

function buildHistoricalSeasonContribs(
  seasonId: string,
  snap: HistoricalSnapshot,
): SeasonContribution[] {
  const champion = deriveHistoricalChampion(snap);
  const ratingRows = ratingGamesFromHistoricalSnapshot(snap);
  const seasonRatings = computeSeasonRatings(ratingRows);
  const ratingByRef = new Map(seasonRatings.map((r) => [r.personRef, r]));

  const contribByKey = new Map<string, SeasonContribution>();
  const aliasesByKey = new Map<string, string[]>();
  const ensure = (identity: LeaderboardIdentity): SeasonContribution => {
    let c = contribByKey.get(identity.key);
    if (!c) { c = emptyContribution(identity); contribByKey.set(identity.key, c); }
    return c;
  };
  const addAlias = (key: string, ref: string) => {
    const arr = aliasesByKey.get(key) ?? [];
    arr.push(ref); aliasesByKey.set(key, arr);
  };

  for (const p of snap.participants ?? []) {
    const identity = p.personId
      ? idPerson(p.personId, p.displayName)
      : idUnlinked(seasonId, p.ref, p.displayName);
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
    // Personal + overall record from weeks
    const rec = extractHistoricalRecordContribution({
      seasonId, role: p.role, participantRef: p.ref,
      weeks: snap.weeks, standings: snap.standings,
    });
    c.gameWins += rec.gameW ?? 0;
    c.setWins += rec.setW ?? 0;
    c.overallWins += rec.pointsWon ?? 0;
    // Frame + POA
    const adv = extractHistoricalAdvancedContribution({
      seasonId, role: p.role, participantRef: p.ref,
      weeks: snap.weeks, standings: snap.standings,
      participantStats: snap.participantStats,
    });
    if (adv.framesRolled != null) {
      c.framesRolled = (c.framesRolled ?? 0) + (adv.framesRolled ?? 0);
      c.strikes = (c.strikes ?? 0) + (adv.strikes ?? 0);
      c.spares = (c.spares ?? 0) + (adv.spares ?? 0);
      c.opens = (c.opens ?? 0) + (adv.opens ?? 0);
      c.openPinsLeft = (c.openPinsLeft ?? 0) + (adv.openPinsLeft ?? 0);
      c.clutchMarks = (c.clutchMarks ?? 0) + (adv.clutchMarks ?? 0);
      c.clutchOpportunities = (c.clutchOpportunities ?? 0) + (adv.clutchOpportunities ?? 0);
    }
    if (adv.poaGames != null && adv.poaSum != null) {
      c.poaSum = (c.poaSum ?? 0) + adv.poaSum;
      c.poaGames = (c.poaGames ?? 0) + adv.poaGames;
    }
    if (champion && champion.participantRef === p.ref) c.championship = true;
    addAlias(identity.key, p.ref);
  }
  // Summary-only rows (no participant meta) — add credit from summaryRecords.
  for (const s of snap.summaryRecords ?? []) {
    // Skip if a participant meta already covers this ref (avoids double-counting
    // games/points).
    if ((snap.participants ?? []).some((p) => p.ref === s.participantRef)) continue;
    const identity = s.personId
      ? idPerson(s.personId, s.displayName)
      : idUnlinked(seasonId, s.participantRef, s.displayName);
    const c = ensure(identity);
    if (s.games != null) c.games += s.games;
    if (s.scratchPinfall != null) c.scratchPinfall += s.scratchPinfall;
    if (s.highGame != null) c.highGame = Math.max(c.highGame ?? 0, s.highGame);
    if (s.highSet != null) c.highSet = Math.max(c.highSet ?? 0, s.highSet);
    if (s.role === "rostered" && s.points != null) c.overallWins += s.points;
    if (s.isChampion) c.championship = true;
  }
  // Ratings per identity via alias combination.
  for (const [key, refs] of aliasesByKey.entries()) {
    const c = contribByKey.get(key);
    if (!c) continue;
    const alias = refs
      .map((ref) => ratingByRef.get(ref))
      .filter((x): x is NonNullable<typeof x> => !!x);
    const combined = combineAliasRatings(alias);
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
// Server function
// ---------------------------------------------------------------------------

export interface AllTimeLeaderboardsResult {
  rows: AllTimeRow[];
  contributingSeasons: number;
}

export const getAllTimeLeaderboards = createServerFn({ method: "GET" })
  .handler(async (): Promise<AllTimeLeaderboardsResult> => {
    const pub = makePublicClient();
    // Season metadata — used both to bound the current snapshot and to
    // filter archived + public_visible historical snapshots.
    const seasonsQ = await (pub.from as unknown as LooseFrom)("seasons")
      .select("id,label,is_current,status,public_visible,champion_person_id");
    if (seasonsQ.error) throw new Error(seasonsQ.error.message);
    interface SeasonMetaRow {
      id: string; label: string; is_current: boolean; status: string;
      public_visible: boolean; champion_person_id: string | null;
    }
    const seasons: SeasonMetaRow[] = (seasonsQ.data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id), label: String(r.label ?? ""),
      is_current: r.is_current === true,
      status: String(r.status ?? ""),
      public_visible: r.public_visible === true,
      champion_person_id: (r.champion_person_id as string | null) ?? null,
    }));

    const allContribs: SeasonContribution[] = [];
    let contributingSeasons = 0;

    // Current season public snapshot — anon SELECT is allowed on
    // public_snapshots for the current season.
    const currentSeason = seasons.find((s) => s.is_current);
    if (currentSeason) {
      const snapQ = await (pub.from as unknown as LooseFrom)("public_snapshots")
        .select("snapshot").eq("season_id", currentSeason.id).maybeSingle();
      if (!snapQ.error && snapQ.data) {
        const snap = snapQ.data.snapshot as PublicSnapshot | null;
        if (snap && Array.isArray(snap.bowlers) && snap.matchesByWeek) {
          const contribs = buildCurrentSeasonContribs({
            seasonId: currentSeason.id,
            championPersonId: currentSeason.champion_person_id,
            snapshot: snap,
          });
          allContribs.push(...contribs);
          if (contribs.length > 0) contributingSeasons += 1;
        }
      }
    }

    // Archived + public_visible historical snapshots. RLS refuses anon
    // SELECT on `historical_season_snapshots`; we load through service role
    // and ALWAYS apply `filterPublicHistoricalSnapshot()` before use.
    const publicArchivedIds = seasons
      .filter((s) => s.status === "archived" && s.public_visible)
      .map((s) => s.id);
    if (publicArchivedIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const sb = supabaseAdmin as unknown as Sb;
      const q = await (sb.from as unknown as LooseFrom)("historical_season_snapshots")
        .select("season_id,snapshot").in("season_id", publicArchivedIds);
      if (!q.error && Array.isArray(q.data)) {
        for (const row of q.data as Array<{ season_id: string; snapshot: HistoricalSnapshot }>) {
          const filtered = filterPublicHistoricalSnapshot(row.snapshot);
          const contribs = buildHistoricalSeasonContribs(row.season_id, filtered);
          allContribs.push(...contribs);
          if (contribs.length > 0) contributingSeasons += 1;
        }
      }
    }

    const rows = aggregateSeasonContributions(allContribs);
    return { rows, contributingSeasons };
  });
