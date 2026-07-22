
# Career Records + All-Time Leaderboards

## 1. New pure module: `src/lib/career-records.ts`

Owns the three new record definitions. No frame-stat coupling.

### Types
```ts
type WLT = { wins: number; losses: number; ties: number } | null;
type WL  = { wins: number; losses: number } | null;

interface CareerRecords {
  gameRecord: WLT;      // personal, per-game handicap outcomes
  setRecord:  WLT;      // personal, per-3-game-set handicap outcomes
  overallRecord: WL;    // roster-credit official points won/lost
}
```

### Contribution shape (one per season / role / identity)
```ts
interface CareerRecordContribution {
  seasonId: string;
  role: "rostered" | "substitute";
  // Personal — from every game/set the person actually rolled.
  gameW: number | null; gameL: number | null; gameT: number | null;
  setW:  number | null; setL:  number | null; setT:  number | null;
  // Roster-credit only. .5 allowed. Populated even when personal is null.
  pointsWon: number | null; pointsLost: number | null;
}
```

`aggregateCareerRecords(contribs)` sums each bucket independently, treating `null` in a bucket as "unavailable, do not zero-fill". If EVERY contribution has `null` for a bucket, the aggregated bucket is `null`.

### Extractors
- `extractCurrentRosterRecordContribution(snapshot, rosterId, seasonId)`
  - Walk `history[rosterId]`: skip absent; when `!isSub` compare handicap game totals and 3-game handicap totals to the opponent — the row already carries `handicapGames[i]` and `opponentHandicapTotal`. For score-only rows, only count pairs in `pairCompleted`.
  - Overall record: `points`/`pointsLost` from `bowlersById[rosterId]`.
- `extractCurrentRosterPersonalIfSubbed(snapshot, rosterId)` — walk history rows where `isSub === true`; personal record is credited via the substitute path, not here. (No-op contribution.)
- `extractCurrentSubstituteRecordContribution(snapshot, subId, seasonId)`
  - Iterate `substituteProfiles[subId].weeks`: personal game/set W-L-T from handicap totals vs the paired opponent handicap totals recorded on the week. No overall.
- `extractHistoricalRecordContribution({ snapshot, participantRef, role, seasonId })`
  - Personal: iterate `snapshot.weeks[*].matches`, matching `actualA/actualB === ref` and `!absent*` and side has `scratchGamesX`; compare `handicapGamesA[i] + handicapA*` – actually `HistoricalMatch` provides `handicapGamesA/B` and `handicapTotalA/B`. Skip games with score `0`/no data (`hasGameDataX === false`).
  - Overall (rostered only): `standings.points` / `standings.pointsLost`.
- Summary-only historical: overall from `summaryRecords[*]` (points, points_lost); personal null.

Dedup: same season+role rule as `dedupeHistoricalContributions` — snapshot-derived wins over pure summary, but summary contributes overall when snapshot lacks it.

### Diagnostics / invariants
`assertCareerRecordInvariants(contribs, aggregated)`:
- personal totals equal sum of contributing buckets;
- for every rostered contribution that carries both `pointsWon` and season `pointSystem`, `pointsWon + pointsLost == pointSystem * matchesCredited` (allowing .5). Verified in test with synthetic data — not enforced against the live DB.

## 2. Wire records into `/people/$personId`

Replace the current "Record (W - L)" card. Insert `Game W-L-T`, `Set W-L-T`, `Overall W-L` as the first three cards of the advanced grid.

Merge contributions from:
- current snapshot (`useCurrentPublicSnapshot`) for all rostered/sub aliases whose `personId === route personId`;
- historical career loader (already fetched via `getHistoricalCareerContributions`) — extend that server fn to also return `recordContributions: CareerRecordContribution[]` from the same filtered snapshots + summary rows so the browser never touches raw historical data.

Formatting: `31-20-3`, `12-5-1`, `92.5-47.5`. Unavailable buckets render `—`.

Update the explanatory paragraph so the three definitions are stated plainly.

## 3. New server fn: `getAllTimeLeaderboards`

File: `src/lib/leaderboards-repo.functions.ts` (new).

Runs entirely on the server, returns COMPACT rows only — never raw snapshots.

### Aggregation
1. Load current public snapshot (via existing `buildFullSnapshot` result stored in `public_snapshots` for the current season) using the service-role client, filtered to visible bowlers/subs.
2. Load every archived+`public_visible` season's `historical_season_snapshots`, then `filterPublicHistoricalSnapshot` each one.
3. For every roster/sub identity, resolve `personId` when present:
   - Aggregate across identities sharing a `personId` — cross-season merged.
   - Identities without `personId` remain their own bucket, labeled `Seasonal identity` in the row `subtitle`, linked to `/bowlers/...` or archived participant route.
4. Compute per-category metrics from already-derived fields (never re-scan frames beyond what extractors already do).

### Categories (single response, one array per category)
```
records: championships, gameWins, setWins, overallWins
scoring: games, scratchPinfall, scratchAverage(min9), highGame, highSet, careerPOA(min9)
frames:  strikes, spares, marks, markPct(min90fr), spareConvPct(min90fr),
         openPctAsc(min90fr), pinsLostAsc(min90fr), clutchPct(min ClutchOpp>=20)
ratings: offensive, defense, twoWay  (reuse computeCareerRatings pipeline;
         eligibility same as existing ratings; run server-side)
```

Each row:
```ts
interface LbRow {
  key: string;              // stable person-or-identity id
  href: string;             // /people/... or /bowlers/... etc
  displayName: string;
  primary: number;          // sort value
  primaryDisplay: string;   // formatted, e.g. "92.5", "12.3%"
  secondary?: string;       // "231 games" / "1,140 frames" / etc
  rank: number;             // competition ranking (shared ties)
}
```

Sorting: metric direction → secondary sample DESC → displayName ASC. Top 10 per category.

### Response shape
```ts
{
  builtAt: number;
  categories: Record<CategoryKey, LbRow[]>;
  eligibility: { minGamesForAvg: 9, minFramesForRates: 90, minClutchOpps: 20 };
}
```

No raw snapshot data leaves the server.

## 4. UI: All-Time Leaderboards on `/seasons` index

Below the archived-seasons grid in `src/routes/seasons.index.tsx`, add `<AllTimeLeaderboards />`.

Component:
- Fetches `getAllTimeLeaderboards` via useQuery.
- Compact grouped tabbed selector: `Records | Scoring | Frame Stats | Ratings`. Inside each group a dropdown (mobile) or radio pill row (md+) picks one category. Renders one Top 10 table at a time.
- Responsive: table on md+, card list on small screens.
- Person rows link to `/people/$personId`, unlinked seasonal identities to their bowler/archived route.

## 5. Tests (`tests/career-records.ts`, registered in `tests/deterministic.ts`)

- current rostered: 3 games win/lose/tie by handicap totals -> personal game W-L-T; set W-L-T from 3-game total.
- current substitute: personal Game/Set present; rostered scheduled bowler receives Overall credit only.
- absent person: no personal, no set, opponent still records outcome per opponent's completed games.
- historical override 0 vs 2.5 in 4-point season: rostered contribution `pointsWon=0, pointsLost=4` and `pointsWon=2.5, pointsLost=1.5`.
- historical 7-point normal: each side pointsWon+pointsLost=7.
- historical GAME_SCORES produces Game/Set W-L-T.
- historical SUMMARY_ONLY → Overall present, personal null.
- multi-alias person: two identities with `personId` collapse; contributions sum without duplication.
- balance invariants pass on fixture.
- unpublished weeks removed by `filterPublicHistoricalSnapshot` don't leak.
- leaderboard sort: descending primary, sample tiebreak, competition ranking for ties, lower-is-better categories reverse; sample eligibility thresholds excluded.
- unlinked seasonal identity appears as its own row, not merged by display name.
- response shape contains no `snapshot` / `weeks` / raw match arrays (grep-style assertion on serialized JSON).
- current 2026 modules (`league-store`, `snapshot-builder.server`, `mock-data.buildSnapshot`) do NOT import `career-records` (module-import assertion).

## 6. Scope guards / non-changes

- `src/lib/mock-data.ts`, `src/lib/snapshot-builder.server.ts`, `src/lib/league-store.ts`, admin schedule/results/live-scoring, DB schema — untouched.
- `historical-snapshot.ts` — untouched except type re-exports if needed.
- Existing chronological sort of Contributing seasons — preserved.
- No new migrations.

## Verification
- `bunx tsgo --noEmit`
- `bun run test:deterministic`
- `bun run build`

## Known limitations to state honestly
- Historical GAME_SCORES sets: the historical scoring pipeline stores per-game handicap totals; set W-L-T uses their sum. Sets with any missing game contribute nothing.
- Ratings leaderboards depend on the existing rating quality thresholds; unqualified persons excluded.
- Overall W-L .5 arises from historical overrides only.
- Unlinked historical participants can appear as separate identities. If two archived seasons have the same unlinked "Bob Smith", they intentionally stay separate to avoid name-only merging.
