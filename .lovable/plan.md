
## Root cause

`extractRosteredSeasonRow` in `src/lib/season-history.ts` (lines 265–276) reads the wrong denominator from the per-season snapshot's `bowlersById[rosterId]` row:

```ts
const games   = numOrNull(b["gamesPlayed"]);     // ← credited/scheduled
const pinfall = numOrNull(b["scratchPinfall"]);  // ← actual rostered pinfall only
const avg     = numOrNull(b["scratchAverage"]);
...
average: avg && games && games > 0 ? avg : avg ?? (pinfall && games && games > 0 ? pinfall / games : null),
```

The bowler object serialized into `bowlersById` is the full `Bowler` built in `src/lib/mock-data.ts` (~L888, L920–984). That builder maintains **two distinct counters**:

| Field                  | Meaning                                                                 | Rob's value |
| ---------------------- | ----------------------------------------------------------------------- | ----------- |
| `gamesPlayed`          | Credited/scheduled games — incremented for every completed match the rostered slot participated in, **including weeks a substitute rolled on his behalf** (L927, L936). | 21 |
| `actualGamesRolled`    | Games actually rolled by the rostered bowler — only incremented when the linescore is `!isSub` (or in the score-only rostered branch), L946, L955, L964, L972. | 15 |
| `scratchPinfall`       | Pinfall from **rostered games only** — sub weeks do NOT add to it (only the actual/rostered branches at L948, L957, L966, L974 touch it). | 2,110 |
| `actualScratchPinfall` | Same base as `scratchPinfall` in current builder, kept as a parallel personal-stat counter. | 2,110 |
| `scratchAverage`       | Computed at L981–983 as `actualScratchPinfall / actualGamesRolled`, rounded to 3 dp. | 140.667 |

So `extractRosteredSeasonRow` combines a personal-only numerator (`scratchPinfall` = 2,110) with a credited denominator (`gamesPlayed` = 21) → **2,110 / 21 ≈ 100.48 ≈ 100.5**, which is exactly what the career page is showing. It also ignores the correctly precomputed `scratchAverage` of 140.667 in its fallback because `avg` truthiness check passes and it returns 110-ish `scratchAverage`… actually the current code does return `scratchAverage` when present, but the surrounding `CareerBody` UI in `src/routes/people.$personId.tsx` renders `r.average` where it exists (140.667 would be correct there) **but** the "Games (avail.)" and "Avg (avail.)" totals in `aggregateCareerTotals` (L124–155) recompute the average as `totalScratchPinfall / totalGames`, and `totalGames` sums `r.games` which is `gamesPlayed`. So the totals row is doing the same 2,110 / 21 math regardless of what per-row `average` says — and if the current-season row is the only one merged in, both the per-row and totals average land near 100.5.

**Root cause in one line:** the personal career stats are computed against `gamesPlayed` (credited, includes sub weeks) instead of `actualGamesRolled` (rostered-only, matches the numerator `scratchPinfall`/`actualScratchPinfall`).

## Correct snapshot fields for career personal stats

Career profiles are meant to reflect what the person actually rolled, distinct from standings. The paired, semantically consistent fields already exist in every snapshot bowler:

- Games: **`actualGamesRolled`** (fall back to `gamesPlayed` only if `actualGamesRolled` is missing on a legacy snapshot, so pre-final-week snapshots still render).
- Pinfall: **`actualScratchPinfall`** (fall back to `scratchPinfall`; both are equal in the current builder, but the `actual*` name is the authoritative personal-stat counter).
- Average: use the precomputed **`scratchAverage`** when present; otherwise derive `actualScratchPinfall / actualGamesRolled`. Do not fall back to the current formula that mixes numerators/denominators.

`highGame` and `highSet` in `bowlersById` are already rostered-only (only the `!isSub` / score-only rostered branches update them), so those career fields are correct and need no change.

## Other affected career fields / call sites / tests (read-only findings)

- `src/lib/season-history.ts` L124–155 `aggregateCareerTotals` — recomputes career average from summed `games` + `scratchPinfall`. Once `extractRosteredSeasonRow` returns `actualGamesRolled`/`actualScratchPinfall` under the `games`/`scratchPinfall` keys of the `CareerSeasonRow`, this aggregator is automatically correct. No behavioural change needed here beyond the fix upstream, but the field docstring should reflect "actual games rolled".
- `src/routes/people.$personId.tsx` — renders `r.games`, `r.average`, and the totals; no change needed once the extractor is fixed. Column header "Games" is fine; the semantic shift (from credited to rostered-only) matches the "personal stats" intent of a career profile.
- `src/lib/historical-snapshot.ts` / `getHistoricalCareerContributions` — historical rows already carry a single `games` field derived from published historical data; they don't have a credited-vs-rostered distinction, so they are not affected by this bug and should not be changed.
- Substitute path (`extractSubstituteSeasonRow`, L307+) — reads `gamesRolled`/`scratchPinfall` from `substituteProfiles`, which are already rostered-truth for subs. Not affected.
- Tests:
  - `tests/season-history.ts` L461–472 — uses a synthetic snapshot with only `gamesPlayed`/`scratchPinfall` and asserts `games === 30`. After the fix this test must be updated to include `actualGamesRolled` / `actualScratchPinfall` on the synthetic bowler and assert against those, plus one new assertion covering the legacy-fallback case (snapshot missing `actual*` fields still returns `gamesPlayed`).
  - `tests/career-merge.ts` — uses precomputed `CareerSeasonRow` inputs, not raw snapshots, so it is not affected.
  - No other test asserts on the mixed numerator/denominator, so the regression surface is small.
- No database / no snapshot rebuild required — every field already exists in every 2026 snapshot row; only the reader picks the wrong keys.

## Deliverable of this audit

No files changed, no database touched. When you're ready to fix, the change is scoped to `extractRosteredSeasonRow` (switch to `actualGamesRolled` + `actualScratchPinfall` with legacy fallback, prefer stored `scratchAverage`), plus the corresponding update to `tests/season-history.ts`.
