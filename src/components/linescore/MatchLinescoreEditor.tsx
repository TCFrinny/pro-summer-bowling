/**
 * Wrapper for a side's three-game linescore editor plus a live derived
 * scratch-set / handicap-set / awards preview when the sibling side is
 * also provided.
 */

import { useCallback, useState } from "react";
import { GameEditor, emptyGameEditorState, type GameEditorState } from "./GameEditor";
import { buildGameFromInput } from "@/lib/frame-input";
import type { GameLinescore } from "@/lib/duckpin";

export interface SideEditorState {
  games: [GameEditorState, GameEditorState, GameEditorState];
}

export function emptySideEditorState(): SideEditorState {
  return { games: [emptyGameEditorState(), emptyGameEditorState(), emptyGameEditorState()] };
}

export interface SideDerived {
  games: (GameLinescore | null)[];
  scratchSet: number | null;
  handicapSet: number | null;
  handicapGames: (number | null)[];
  valid: boolean;
}

export function computeSideDerived(state: SideEditorState, handicap: number): SideDerived {
  const built: (GameLinescore | null)[] = [null, null, null];
  const hcpGames: (number | null)[] = [null, null, null];
  let scratchSet = 0;
  let allValid = true;
  for (let i = 0; i < 3; i++) {
    const g = state.games[i];
    const complete = g.marks.every((m) => m.trim() !== "") &&
      g.cumulatives.every((c) => c.trim() !== "");
    if (!complete) { allValid = false; continue; }
    const cums = g.cumulatives.map((c) => Number(c));
    const r = buildGameFromInput({ marks: g.marks, cumulatives: cums });
    if (!r.game) { allValid = false; continue; }
    built[i] = r.game;
    hcpGames[i] = r.game.scratchTotal + handicap;
    scratchSet += r.game.scratchTotal;
  }
  return {
    games: built,
    scratchSet: allValid ? scratchSet : null,
    handicapSet: allValid ? scratchSet + handicap * 3 : null,
    handicapGames: hcpGames,
    valid: allValid,
  };
}

export interface SideLinescoreEditorProps {
  label: string;
  handicap: number;
  disabled?: boolean;
  state: SideEditorState;
  onChange: (next: SideEditorState) => void;
}

export function SideLinescoreEditor({
  label, handicap, disabled, state, onChange,
}: SideLinescoreEditorProps) {
  const [, force] = useState(0);
  const set = useCallback(
    (i: number, next: GameEditorState) => {
      const games = [...state.games] as SideEditorState["games"];
      games[i] = next;
      onChange({ ...state, games });
      force((n) => n + 1);
    },
    [state, onChange],
  );
  if (disabled) {
    return (
      <div className="rounded-md border border-dashed border-border bg-background/20 p-4 text-center text-xs text-muted-foreground">
        {label} · absent — no linescore recorded
      </div>
    );
  }
  const derived = computeSideDerived(state, handicap);
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        <div className="text-[11px] text-muted-foreground">
          hcp <span className="font-mono text-foreground">{handicap}</span>
          {derived.scratchSet != null && (
            <>
              {" · scratch set "}
              <span className="font-mono text-foreground">{derived.scratchSet}</span>
              {" · hcp set "}
              <span className="font-mono text-gold">{derived.handicapSet}</span>
            </>
          )}
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <GameEditor
          key={i}
          label={`Game ${i + 1}`}
          value={state.games[i]}
          onChange={(next) => set(i, next)}
        />
      ))}
    </div>
  );
}
