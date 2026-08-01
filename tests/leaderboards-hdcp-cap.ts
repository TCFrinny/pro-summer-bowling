/**
 * v2.0.10 — Standard Leaderboards HDCP cap rule and stale-snapshot repair.
 *
 * The duckpin 200+/500+ milestone expansion is SCRATCH ONLY. HDCP High
 * Game / High Set boards show the Top 10 handicap performances plus every
 * performance tied at the 10th-place cutoff score, and nothing else.
 */
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`[leaderboards-hdcp-cap] ${msg}`);
}

await (async () => {
  const { topNWithCutoffTies, mergeMilestoneRows, HIGH_GAME_MILESTONE, HIGH_SET_MILESTONE } =
    await import("../src/lib/leaderboard-milestone");

  type R = { name: string; v: number };
  const rows = (vals: number[]): R[] =>
    vals.map((v, i) => ({ name: `p${i}`, v }));

  // (1) >10 HDCP games above 200 → only Top 10 (no milestone expansion).
  {
    const all = rows([260, 255, 250, 245, 240, 235, 230, 225, 220, 215, 210, 205, 201]);
    const board = topNWithCutoffTies(all, (r) => r.v, 10);
    assert(board.length === 10, `Top 10 only, got ${board.length}`);
    assert(board[9]!.v === 215, "10th place is the cutoff value");
    assert(!board.some((r) => r.v < 215), "no row below the cutoff, even at 200+");
  }

  // (2) >10 HDCP sets above 500 → same rule.
  {
    const all = rows([700, 690, 680, 670, 660, 650, 640, 630, 620, 610, 600, 590, 501]);
    const board = topNWithCutoffTies(all, (r) => r.v, 10);
    assert(board.length === 10, `sets Top 10 only, got ${board.length}`);
    assert(!board.some((r) => r.v < 610), "sub-cutoff 500+ sets excluded");
  }

  // (3) All ties at the 10th-place cutoff are retained (performance-level,
  //     so duplicate values from different rows are all valid).
  {
    const all = rows([260, 255, 250, 245, 240, 235, 230, 225, 220, 215, 215, 215, 214]);
    const board = topNWithCutoffTies(all, (r) => r.v, 10);
    assert(board.length === 12, `all cutoff ties kept, got ${board.length}`);
    assert(board.filter((r) => r.v === 215).length === 3, "3 rows tied at 215 kept");
    assert(!board.some((r) => r.v === 214), "row below cutoff excluded");
  }

  // (4) Fewer than 10 rows: everything returned, sorted descending.
  {
    const board = topNWithCutoffTies(rows([180, 220, 200]), (r) => r.v, 10);
    assert(board.length === 3 && board[0]!.v === 220 && board[2]!.v === 180,
      "fewer than N rows returned sorted descending");
  }

  // (5) Scratch milestone expansion is unchanged.
  {
    const all = rows([260, 255, 250, 245, 240, 210, 205, 200, 199]);
    const base = [...all].sort((a, b) => b.v - a.v).slice(0, 5);
    const merged = mergeMilestoneRows(base, all, (r) => r.v, HIGH_GAME_MILESTONE);
    assert(merged.length === 8, `scratch keeps all 200+ rows, got ${merged.length}`);
    assert(!merged.some((r) => r.v === 199), "199 not a scratch milestone");
    assert(HIGH_GAME_MILESTONE === 200 && HIGH_SET_MILESTONE === 500,
      "scratch thresholds unchanged");
  }

  // (6) Season and every weekly scope of the shared standard builder obey
  //     the corrected HDCP rule.
  {
    const { getStandardLeaderboards, WEEKS } = await import("../src/lib/mock-data");
    const scopes: Array<"season" | number> = [
      "season",
      ...WEEKS.filter((w) => w.completed).map((w) => w.week),
    ];
    for (const scope of scopes) {
      const b = getStandardLeaderboards(scope);
      for (const [label, entries, val] of [
        ["hcpHighGame", b.hcpHighGame, (r: { handicap: number }) => r.handicap],
        ["hcpHighSeries", b.hcpHighSeries, (r: { handicapSet: number }) => r.handicapSet],
      ] as const) {
        const vals = (entries as readonly any[]).map((r) => (val as any)(r));
        for (let i = 1; i < vals.length; i++) {
          assert(vals[i]! <= vals[i - 1]!, `${label} descending for scope ${scope}`);
        }
        if (vals.length > 10) {
          const cutoff = vals[9]!;
          assert(vals.slice(10).every((v) => v === cutoff),
            `${label} rows past 10 exist only as cutoff ties (scope ${scope})`);
        }
      }
    }
  }

  // (7) Legacy persisted boards are capped at read time without touching
  //     scratch or unrelated arrays. This reproduces the production symptom:
  //     38 HDCP games and 91 HDCP sets persisted before v2.0.9.
  {
    const {
      _installSnapshotProvider,
      getStandardLeaderboards,
      normalizeStandardLeaderboards,
    } = await import("../src/lib/mock-data");
    const { getLeagueState } = await import("../src/lib/league-store");
    type GameRow = {
      bowlerId: string;
      bowlerName: string;
      week: number;
      matchId: string;
      opponent: string;
      scratch: number;
      handicap: number;
    };
    type SetRow = {
      bowlerId: string;
      bowlerName: string;
      week: number;
      matchId: string;
      opponent: string;
      scratchSet: number;
      handicapSet: number;
    };
    const gameValues = Array.from({ length: 38 }, (_, i) => 300 - i);
    gameValues[10] = gameValues[9]!;
    gameValues[11] = gameValues[9]!;
    const setValues = Array.from({ length: 91 }, (_, i) => 700 - i);
    setValues[10] = setValues[9]!;
    setValues[11] = setValues[9]!;
    const games: GameRow[] = gameValues.map((handicap, i) => ({
      bowlerId: `g${i}`,
      bowlerName: `Game ${i}`,
      week: 1,
      matchId: `gm${i}`,
      opponent: "Opponent",
      scratch: handicap - 20,
      handicap,
    }));
    const sets: SetRow[] = setValues.map((handicapSet, i) => ({
      bowlerId: `s${i}`,
      bowlerName: `Set ${i}`,
      week: 1,
      matchId: `sm${i}`,
      opponent: "Opponent",
      scratchSet: handicapSet - 60,
      handicapSet,
    }));
    const current = getLeagueState().snapshot;
    const scratchGames = current.seasonBoards.standard.scratchHighGame;
    const scratchSets = current.seasonBoards.standard.scratchHighSeries;
    const legacy = {
      ...current.seasonBoards.standard,
      scratchHighGame: scratchGames,
      scratchHighSeries: scratchSets,
      hcpHighGame: games,
      hcpHighSeries: sets,
    };

    const normalized = normalizeStandardLeaderboards(legacy);
    assert(normalized !== legacy, "normalization returns a safe board copy");
    assert(normalized.hcpHighGame.length === 12,
      `38 legacy games become Top 10 plus ties, got ${normalized.hcpHighGame.length}`);
    assert(normalized.hcpHighSeries.length === 12,
      `91 legacy sets become Top 10 plus ties, got ${normalized.hcpHighSeries.length}`);
    assert(normalized.hcpHighGame.every((r) => r.handicap >= gameValues[9]!),
      "200+ HDCP games below the cutoff are removed");
    assert(normalized.hcpHighSeries.every((r) => r.handicapSet >= setValues[9]!),
      "500+ HDCP sets below the cutoff are removed");
    assert(normalized.hcpHighGame.filter((r) => r.handicap === gameValues[9]).length === 3,
      "all HDCP game cutoff ties remain");
    assert(normalized.hcpHighSeries.filter((r) => r.handicapSet === setValues[9]).length === 3,
      "all HDCP set cutoff ties remain");
    assert(normalized.scratchHighGame === scratchGames && normalized.scratchHighSeries === scratchSets,
      "scratch arrays remain byte-for-byte/reference-content unchanged");
    assert(legacy.hcpHighGame.length === 38 && legacy.hcpHighSeries.length === 91,
      "persisted legacy board is not mutated");
    const normalizedAgain = normalizeStandardLeaderboards(normalized);
    assert(JSON.stringify(normalizedAgain) === JSON.stringify(normalized),
      "normalizing an already-correct board is idempotent");

    const fakeSnapshot = {
      ...current,
      seasonBoards: { ...current.seasonBoards, standard: legacy },
      weekBoards: {
        ...current.weekBoards,
        99: { standard: legacy, advanced: current.seasonBoards.advanced },
      },
    };
    _installSnapshotProvider(() => fakeSnapshot);
    try {
      assert(getStandardLeaderboards("season").hcpHighGame.length === 12,
        "season read path normalizes stale HDCP games");
      assert(getStandardLeaderboards(99).hcpHighSeries.length === 12,
        "weekly read path normalizes stale HDCP sets");
    } finally {
      _installSnapshotProvider(() => getLeagueState().snapshot);
    }
  }
})();

// eslint-disable-next-line no-console
console.log("v2.0.10 HDCP leaderboard read normalization OK");
