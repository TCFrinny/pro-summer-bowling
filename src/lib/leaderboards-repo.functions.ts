/**
 * All-Time Leaderboards — server function.
 *
 * Reads:
 *   - The current-season `public_snapshots` row (already the public projection).
 *   - Every archived + public_visible historical snapshot, filtered through
 *     `filterPublicHistoricalSnapshot()` before any aggregation.
 *
 * Aggregation is delegated to the pure `leaderboards-contrib` module so tests
 * can exercise every rule (published-week gating, identity routing, ratings
 * via `computeCareerRatings`) without touching Supabase.
 */

import { createServerFn } from "@tanstack/react-start";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  aggregateSeasonContributions,
  type AllTimeRow,
  type PerformanceRow,
  type SeasonContribution,
} from "@/lib/leaderboards";
import type { PublicSnapshot } from "@/lib/mock-data";
import {
  buildCurrentSeasonContribs,
  buildCurrentSeasonPerformances,
  buildHistoricalSeasonContribs,
  buildHistoricalSeasonPerformances,
  extractYearFromLabel,
  selectPublicHistoricalSeasonIds,
  type SeasonMetaLite,
} from "@/lib/leaderboards-contrib";
import {
  filterPublicHistoricalSnapshot,
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

export interface AllTimeLeaderboardsResult {
  rows: AllTimeRow[];
  performances: PerformanceRow[];
  contributingSeasons: number;
}

export const getAllTimeLeaderboards = createServerFn({ method: "GET" })
  .handler(async (): Promise<AllTimeLeaderboardsResult> => {
    const pub = makePublicClient();
    const seasonsQ = await (pub.from as unknown as LooseFrom)("seasons")
      .select("id,label,is_current,status,public_visible,champion_person_id");
    if (seasonsQ.error) throw new Error(`seasons query failed: ${seasonsQ.error.message}`);
    interface SeasonMetaRow extends SeasonMetaLite {
      label: string;
      championPersonId: string | null;
    }
    const seasons: SeasonMetaRow[] = (seasonsQ.data ?? []).map((r: Record<string, unknown>) => ({
      id: String(r.id),
      label: String(r.label ?? ""),
      isCurrent: r.is_current === true,
      status: String(r.status ?? ""),
      publicVisible: r.public_visible === true,
      championPersonId: (r.champion_person_id as string | null) ?? null,
    }));

    const allContribs: SeasonContribution[] = [];
    const allPerfs: PerformanceRow[] = [];
    let contributingSeasons = 0;

    const currentSeason = seasons.find((s) => s.isCurrent);
    if (currentSeason) {
      const snapQ = await (pub.from as unknown as LooseFrom)("public_snapshots")
        .select("snapshot").eq("season_id", currentSeason.id).maybeSingle();
      if (snapQ.error) throw new Error(`current snapshot query failed: ${snapQ.error.message}`);
      if (snapQ.data) {
        const snap = snapQ.data.snapshot as PublicSnapshot | null;
        if (snap && Array.isArray(snap.bowlers) && snap.matchesByWeek) {
          const input = {
            seasonId: currentSeason.id,
            seasonLabel: currentSeason.label,
            seasonSortYear: extractYearFromLabel(currentSeason.label),
            championPersonId: currentSeason.championPersonId,
            snapshot: snap,
          };
          const contribs = buildCurrentSeasonContribs(input);
          const perfs = buildCurrentSeasonPerformances(input);
          allContribs.push(...contribs);
          allPerfs.push(...perfs);
          if (contribs.length > 0 || perfs.length > 0) contributingSeasons += 1;
        }
      }
    }

    const publicArchivedIds = selectPublicHistoricalSeasonIds(seasons);
    if (publicArchivedIds.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const sb = supabaseAdmin as unknown as Sb;
      const q = await (sb.from as unknown as LooseFrom)("historical_season_snapshots")
        .select("season_id,snapshot").in("season_id", publicArchivedIds);
      if (q.error) throw new Error(`historical snapshots query failed: ${q.error.message}`);
      for (const row of (q.data as Array<{ season_id: string; snapshot: HistoricalSnapshot }>) ?? []) {
        const filtered = filterPublicHistoricalSnapshot(row.snapshot);
        const contribs = buildHistoricalSeasonContribs(row.season_id, filtered);
        const perfs = buildHistoricalSeasonPerformances(row.season_id, filtered);
        allContribs.push(...contribs);
        allPerfs.push(...perfs);
        if (contribs.length > 0 || perfs.length > 0) contributingSeasons += 1;
      }
    }

    const rows = aggregateSeasonContributions(allContribs);
    return { rows, performances: allPerfs, contributingSeasons };
  });
