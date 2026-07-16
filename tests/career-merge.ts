/**
 * Regression: mergeHistoricalIntoCareer preserves current-season primary
 * rows exactly and only fills gaps from historical contributions.
 */
import { mergeHistoricalIntoCareer, type CareerSeasonRow } from "../src/lib/season-history";

const primary: CareerSeasonRow[] = [
  {
    seasonId: "current-2026",
    seasonLabel: "2026",
    role: "rostered",
    seasonalName: "Ann",
    hasGameData: true,
    games: 30,
    scratchPinfall: 3300,
    highGame: 180,
    highSet: 500,
    points: 42,
    finalFinish: 4,
    isChampion: false,
  },
];

const historical = [
  // Overlapping season+role: has less info than primary → primary must win.
  {
    seasonId: "current-2026", seasonLabel: "2026-hist", role: "rostered" as const,
    displayName: "Ann-hist", bowlerNumber: null,
    startingAverage: null, handicap: null,
    games: null, scratchPinfall: null, average: null,
    highGame: null, highSet: null, points: null, finalFinish: null,
    isChampion: false, hasGameData: false,
    source: "historical_summary" as const,
  },
  // Gap-fill from real historical snapshot.
  {
    seasonId: "s2025", seasonLabel: "2025", role: "rostered" as const,
    displayName: "Ann", bowlerNumber: "12",
    startingAverage: 108, handicap: 40,
    games: 27, scratchPinfall: 2916, average: 108,
    highGame: 175, highSet: 480, points: 38, finalFinish: 6,
    isChampion: false, hasGameData: true,
    source: "historical_snapshot" as const,
  },
  // Summary-only fallback for another season.
  {
    seasonId: "s2024", seasonLabel: "2024", role: "rostered" as const,
    displayName: "Ann", bowlerNumber: null,
    startingAverage: null, handicap: null,
    games: null, scratchPinfall: null, average: null,
    highGame: null, highSet: null, points: null, finalFinish: 3,
    isChampion: true, hasGameData: false,
    source: "historical_summary" as const,
  },
];

const merged = mergeHistoricalIntoCareer(primary, historical);
if (merged.length !== 3) throw new Error(`expected 3 rows, got ${merged.length}`);

const cur = merged.find((r) => r.seasonId === "current-2026");
if (!cur) throw new Error("current 2026 row missing");
if (cur.games !== 30 || cur.seasonLabel !== "2026") {
  throw new Error("primary row was overwritten by weaker historical row");
}

const s2025 = merged.find((r) => r.seasonId === "s2025");
if (!s2025 || s2025.games !== 27 || !s2025.hasGameData) {
  throw new Error("historical snapshot row did not fill gap");
}

const s2024 = merged.find((r) => r.seasonId === "s2024");
if (!s2024 || s2024.hasGameData || !s2024.isChampion) {
  throw new Error("summary-only row should still be visible with isChampion");
}

// Adding a historical WITH game data for a season the primary lacks data on
// should replace the empty primary.
const primary2: CareerSeasonRow[] = [
  { seasonId: "s2025", seasonLabel: "2025", role: "rostered",
    seasonalName: "Ann", hasGameData: false, isChampion: false },
];
const historical2 = [{
  seasonId: "s2025", seasonLabel: "2025", role: "rostered" as const,
  displayName: "Ann", bowlerNumber: null,
  startingAverage: null, handicap: null,
  games: 27, scratchPinfall: 2916, average: 108,
  highGame: 175, highSet: 480, points: 38, finalFinish: 6,
  isChampion: false, hasGameData: true,
  source: "historical_snapshot" as const,
}];
const merged2 = mergeHistoricalIntoCareer(primary2, historical2);
if (merged2.length !== 1 || !merged2[0]!.hasGameData || merged2[0]!.games !== 27) {
  throw new Error("historical-with-data should beat primary-without-data");
}

console.log("career-merge tests passed");
