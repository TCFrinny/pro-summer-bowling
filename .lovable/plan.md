
## 1. Per-game First 5 / Last 5 / Big Opening / Big Finish

`src/lib/duckpin.ts` — `summarizeGame` already computes per-game
`segments.first5`, `.last5`, `.bigOpening`, `.bigFinish`, `.clutchMarks`.
No math change; kept as the per-game source of truth. `matchSegmentsOf`
(sum of the three games) is retained only for `BowlerMatchLinescore.segments`
so per-match cards on Weekly Results / profile week-row keep working.

`src/lib/mock-data.ts`
- `BowlerSeasonExtras`: rename `first5PerMatch → first5PerGame`,
  `last5PerMatch → last5PerGame`, `bigOpeningPerMatch → bigOpeningPerGame`,
  `bigFinishPerMatch → bigFinishPerGame`. Keep season totals unchanged.
- `AdvancedRow`: same rename. Add `gamesForSegments` (roster-only games).
- `buildSnapshot` accumulators: divide segment totals by
  `rosterGames = rosterMatches * 3`, not by matches.
- Big Opening / Big Finish thresholds already evaluated per game inside
  `summarizeGame` (unchanged); the aggregator just sums per-game hits.
- Substitute games remain excluded from the scheduled bowler's roster
  aggregator via the existing `!ls.isSub` guard. Absent sides continue
  to contribute nothing.

Consumers updated for the new field names:
- `src/routes/leaderboards.advanced.tsx` — swap `first5PerMatch` etc.
  for `first5PerGame`; drop the "Match total" branching in single-week
  view (always per-game); update card titles/help text to say
  "Pins / game" and thresholds "per game".
- `src/routes/bowlers.$bowlerId.tsx` — Stat labels become "First 5 / game",
  "Last 5 / game", "Big Opening / game", "Big Finish / game".

## 2. Pins Lost per game

`src/lib/mock-data.ts` — replace `pinsLost = openPinsLeft / opens` with
`pinsLost = games > 0 ? openPinsLeft / games : 0`. Denominator = actual
roster games rolled (matches × 3, sub games excluded). Weekly row
`weekPinsLost` becomes `openPinsLeft / 3` for the 3-game match. Format
stays `.toFixed(2)`.

Consumers renaming label "Pins Lost" → "Pins Lost / Game":
- `src/routes/bowlers.$bowlerId.tsx`
- `src/routes/leaderboards.advanced.tsx` (board title + help)

## 3. Substitute starting average + handicap

`src/lib/mock-data.ts`
- `SubstituteRecord` (defined in `league-store.ts` — see below) gains
  `startingAverage: number` and derived `handicap` (recomputed on
  save).
- `MatchResult` already stores frozen `entryAverageA/B` and
  `handicapA/B`. When side A/B is a substitute, `applyResult` now
  writes the SUBSTITUTE's frozen starting average / handicap into
  those fields, instead of the scheduled bowler's. Roster W-L and
  handicap pinfall continue to credit the scheduled bowler because
  `buildSnapshot` accumulates by `scheduledId`.
- `BowlerMatchLinescore.entryAverage/handicap` for the sub side become
  the sub's starting average / handicap (already flows from
  `applyResult` -> `assembleSideLinescore`).
- Sub scratch/segments/opens continue to be excluded from the
  scheduled bowler's advanced totals (`!ls.isSub` guard, unchanged).

`src/lib/league-store.ts`
- `SubstituteRecord`: add `bowlerNumber: string; startingAverage:
  number; handicap: number`.
- `RosteredBowlerRecord`: add `bowlerNumber: string`.
- Validators: `isDigitsOnly`, `isDuplicateActiveBowlerNumber` (checks
  across both rostered and sub active pools).
- `addSubstitute(name, bowlerNumber, startingAverage)`,
  `updateSubstitute(id, patch)` — recompute handicap on avg change.
- `addRosteredBowler(name, entryAverage, bowlerNumber)`,
  `updateRosteredBowler(id, patch)` unchanged apart from ID validation.
- `applyResult`: when a side is `"substitute"`, resolve the pool entry
  and freeze `entryAverage = sub.startingAverage`, `handicap =
  sub.handicap` into the `MatchResult`. Free-form typed subs are
  removed from the flow — result entry must pick from pool.
- Schedule freezing: `ScheduleSlot` gains optional `bowlerNumberA`,
  `bowlerNumberB` set at slot publish; display fallback is current
  roster number.

## 4. Bowler ID number on schedules

`src/lib/mock-data.ts` — add optional `bowlerNumber?: string` to
`Match`, populated from `ScheduleSlot` at `applyScheduleSlots`.
Helper `formatScheduleName(name, number)` -> `Name (ID 01234)`.

Displays updated (schedule ONLY):
- `src/routes/schedule.tsx` — render `formatScheduleName(...)` for
  every scheduled bowler cell.
- `src/routes/admin.schedule.tsx` — same, in the picker preview /
  saved-row summary rows.

Explicitly NOT changed (must not show ID): Standings, Weekly Results,
bowler profiles, statistics, leaderboards, lane data, admin results
linescore headings.

## 5. Migration + seed

`SCHEMA_VERSION` bump from 3 → 4. `STORAGE_KEY = "pss.leagueStore.v4"`.
Migration path v3 → v4:
- Rostered records: assign `bowlerNumber = "1" + b0..b35` -> e.g.
  `10001`..`10036` (5 digits, digits-only, unique). Admin can rename.
- Sub records: assign `bowlerNumber = "2" + index` and default
  `startingAverage = 140` (with recomputed handicap). Present a banner
  on `/admin/bowlers` prompting the admin to replace the migrated
  defaults.
- Schedule slots: leave `bowlerNumberA/B` unset; renderer falls back
  to current roster number.

Seed data (`seedBowlers`, seed subs) generate real `bowlerNumber` and
`startingAverage` fields so a fresh install has correct IDs from turn 1.

## 6. Tests

`src/lib/league-store.ts` self-test IIFE gains cases:
- Per-game First 5 / Last 5 fixture with three distinct games.
- Big Opening / Big Finish counted per game.
- Pins Lost / Game denominator = games (not opens, not matches).
- Sub with `startingAverage=100, handicap=48` writes handicap 48 into
  `MatchResult`, credits points to scheduled bowler, and leaves
  scheduled scratch average unchanged.
- Digits-only ID validation, duplicate active ID rejection, leading
  zero preservation ("01234" stays a string).
- v3 → v4 migration produces valid records.

`tests/admin-result-flow.py` additions:
- Assert `Schedule` page shows `Name (ID …)`.
- Assert `Standings` and `Weekly Results` do NOT include `ID` in the
  row label.
- Assert Advanced leaderboard renders "Pins / Game" / "Pins Lost /
  Game" labels.

## 7. Verification (run and report all four)

```text
bunx tsgo --noEmit
bun run test:deterministic
python3 tests/admin-result-flow.py
bun run build
```

Plus curl 200 smoke on `/`, `/standings`, `/weekly-results`,
`/bowlers`, `/schedule`, `/leaderboards`, `/leaderboards/advanced`,
`/admin/bowlers`, `/admin/schedule`, `/admin/results`.

## 8. Explicitly out of scope

- Enabling Lovable Cloud / auth / DB (Phase 1 stays in localStorage).
- Publishing / deploy.
- Substitute-side statistical identity page (spec says "if the data
  model tracks substitute statistics" — current model does not, and
  adding a full public sub-profile route is a larger phase-2 task).
  Sub scratch remains visible on the roster bowler's weekly row with
  the existing "sub performance excluded" notice; no leak.

Approve and I will execute in one pass, then report the four command
outputs verbatim.
