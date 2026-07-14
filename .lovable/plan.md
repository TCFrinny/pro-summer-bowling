
## Goal

Replace game-total mock data with real duckpin frame-by-frame linescores as the single source of truth, add reusable frame linescore UI, and create Standard + Advanced Leaderboards pages that mirror the reference Flask site.

## 1. New frame-level data model (`src/lib/mock-data.ts`)

New types:
- `Roll` — number 0–10
- `Frame` — `{ frameNumber, rolls: number[], mark: "X"|"/"|"-"|<tenth combo>, isStrike, isSpare, isOpen, framePinfall, bonus, cumulative }`
- `GameLinescore` — `{ frames: Frame[10], scratchTotal }`
- `BowlerMatchLinescore` — `{ scheduledId, actualId, isSub, entryAverage, handicap, games: [GameLinescore,GameLinescore,GameLinescore], scratchSet, handicapGames, handicapSet, strikes, spares, opens, marks, openPinsLeft, framesRolled }`
- `CompletedMatch` — `{ sideA, sideB, gameAwardsA/B, setPointA/B, totalPointsA/B, winner }`

Keep existing `Match` shell + `MatchResult` compatibility shim (thin adapter that derives the old fields from the new linescore so existing routes keep rendering while migrated).

## 2. Duckpin scoring engine

Pure functions:
- `rollGame(rand)` → produces a deterministic legal `GameLinescore` for duckpin: frames 1–9 with up to 3 balls (strike ends frame; spare ends frame; otherwise 3rd ball). 10th frame supports XXX, XX, X/, /X, X, /, and open outcomes with bonus balls.
- `scoreFrames(frames)` → applies strike (+ next 2 balls) and spare (+ next 1 ball) bonuses across frame boundaries; writes `cumulative` per frame; final cumulative = scratch total.
- `classifyFrame(frame)` → exactly one of strike/spare/open per regulation frame (10th classified by initial mark).
- `computeVolumeStats(games)` → strikes, spares, opens, marks, openPinsLeft.

Development-time validators (run at module load; throw on failure):
- ball pin counts legal and don't exceed remaining pins in a frame
- early termination on strike/spare in frames 1–9
- legal 10th-frame bonus deliveries
- monotonic cumulative & final = scratchTotal
- scratch set = sum of 3 game totals
- handicap totals correct
- each match distributes exactly 7 points
- every regulation frame classifies as exactly one of strike/spare/open

## 3. Reusable frame UI (`src/components/linescore/`)

- `FrameBox.tsx` — one 10-frame cell: number top, mark middle, cumulative bottom; wider 10th frame for 3 balls.
- `GameLinescore.tsx` — card titled `Game N • Scratch NNN` with 10 `FrameBox` in a row.
- `ThreeGameLinescore.tsx` — stacks 3 game cards for one bowler; horizontal scroll on narrow screens.
- Styled to match dark navy / gold / red identity.

## 4. Routes

### Update
- `src/routes/weekly-results.tsx` — replace game-total table with compact per-bowler summary + collapsible `ThreeGameLinescore` per side ("View full linescore"). Keep 7-point breakdown legend.
- `src/routes/bowlers.$bowlerId.tsx` — per-week rows now include collapsible full frame linescore, weekly strikes/spares/opens/marks/mark%/POA; season summary cards derived from frames.
- `src/routes/statistics.tsx` — keep as-is but drop hand-entered high-game/high-set/etc; all derived. (Or slim it since Leaderboards now owns most of this — see below.)
- `src/routes/__root.tsx` (nav) — add Leaderboards link.

### New
- `src/routes/leaderboards.tsx` (`/leaderboards`) — layout with `<Outlet />` + shared Week/Season selector via search param (`?view=season|week-N`).
- `src/routes/leaderboards.index.tsx` — Standard boards:
  - Scratch (roster-only): High Game top 5, High Series top 5, Top Scratch Averages
  - Points/HCP (credited to scheduled bowler): High Game HCP, High Series HCP, Top Total Points
  - Volume: Most Strikes, Most Spares, Fewest Opens
  - Header note: "Scratch roster-only • Points/HCP credited"
  - Link to Advanced.
- `src/routes/leaderboards.advanced.tsx` — Advanced boards (roster-only, subs excluded):
  - Mark %, Strike %, Spare Conversion %, Open % (lower better), Pins Lost (lower better), Consistency (stdev, min 6 games for Season; hidden for week view), Total Marks, plus raw counts.
  - Eligibility ≥3 games for % boards.
  - Helper text explaining each metric.

## 5. Aggregation

New once-at-module-load pass builds:
- `SEASON_LEADERBOARDS` and `WEEK_LEADERBOARDS[week]` cached structures containing all leaderboard rows (roster-only vs credited splits) and per-bowler advanced metrics.
- Public routes read these cached snapshots — no per-render recalculation.

## 6. Docs & verification

- Update `README.md`: frame-level source of truth, leaderboard credit rules, roster-only vs credited distinction, advanced metric formulas.
- Run `bunx tsgo --noEmit` and full production build; fix any errors.

## Assumptions

- Frame count for %s uses regulation frames only (bonus 10th balls don't add frames), noted in docs and helper text.
- Substitutes in mock data: when `isSub` is true we synthesize an off-roster actual bowler name (e.g. "Sub — Rick M.") so roster-only filtering has something to exclude. Points/HCP still credit the scheduled bowler.
- Consistency uses population stdev of the 3 scratch games per set, aggregated across a bowler's games in scope.

## Files touched

New: `src/components/linescore/FrameBox.tsx`, `GameLinescore.tsx`, `ThreeGameLinescore.tsx`; `src/routes/leaderboards.tsx`, `leaderboards.index.tsx`, `leaderboards.advanced.tsx`.
Edited: `src/lib/mock-data.ts` (major rewrite of match generation + validators + leaderboard cache), `src/routes/weekly-results.tsx`, `src/routes/bowlers.$bowlerId.tsx`, `src/routes/__root.tsx` (nav), `README.md`.
