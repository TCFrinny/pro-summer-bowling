/**
 * 10-frame linescore editor for admin result entry.
 *
 * Two inputs per frame: MARK (compact notation) and RUNNING TOTAL. The
 * final frame-10 running total IS the game's scratch score. Validation
 * happens in `buildGameFromInput`; this component just renders the grid
 * and reports the current parse result upstream via `onChange`.
 */

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { buildGameFromInput, type GameBuildResult } from "@/lib/frame-input";

export interface GameEditorState {
  marks: string[];         // length 10
  cumulatives: string[];   // length 10 (raw text so admin can clear)
}

export function emptyGameEditorState(): GameEditorState {
  return { marks: Array(10).fill(""), cumulatives: Array(10).fill("") };
}

export interface GameEditorProps {
  label: string;
  value: GameEditorState;
  onChange: (next: GameEditorState) => void;
  onResult?: (result: GameBuildResult) => void;
  /** Stable prefix for data-testids, e.g. `side-A-g1`. Each frame's mark
   *  input becomes `${testPrefix}-mark-${i}` and cumulative
   *  `${testPrefix}-cum-${i}` where `i` is 0..9. */
  testPrefix?: string;
}

export function GameEditor({ label, value, onChange, onResult, testPrefix }: GameEditorProps) {
  const result = useMemo(() => {
    // Only attempt to build when every field has content — otherwise we'd
    // spam errors while the admin is still typing.
    const complete = value.marks.every((m) => m.trim() !== "") &&
      value.cumulatives.every((c) => c.trim() !== "");
    if (!complete) {
      return { game: null, errors: [] } satisfies GameBuildResult;
    }
    const cums = value.cumulatives.map((c) => Number(c));
    return buildGameFromInput({ marks: value.marks, cumulatives: cums });
  }, [value]);

  // Notify parent whenever result changes.
  useMemo(() => { onResult?.(result); return null; }, [result, onResult]);

  const setMark = (i: number, v: string) => {
    const marks = [...value.marks];
    marks[i] = v;
    onChange({ ...value, marks });
  };
  const setCum = (i: number, v: string) => {
    const cumulatives = [...value.cumulatives];
    cumulatives[i] = v;
    onChange({ ...value, cumulatives });
  };

  const currentScratch = result.game?.scratchTotal ?? null;

  return (
    <div className="rounded-md border border-border bg-background/40 p-2">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        <div className="text-xs">
          {currentScratch != null ? (
            <span className="font-display text-base text-gold">{currentScratch}</span>
          ) : result.errors.length > 0 ? (
            <span className="text-destructive">{result.errors.length} error(s)</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-10 gap-1 text-center">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="text-[9px] uppercase tracking-widest text-muted-foreground">
            {i + 1}
          </div>
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <Input
            key={`m${i}`}
            value={value.marks[i]}
            onChange={(e) => setMark(i, e.target.value)}
            className="h-8 px-1 text-center text-xs uppercase"
            placeholder={i === 9 ? "XXX" : "X"}
            aria-label={`Frame ${i + 1} mark`}
            data-testid={testPrefix ? `${testPrefix}-mark-${i}` : undefined}
          />
        ))}
        {Array.from({ length: 10 }).map((_, i) => (
          <Input
            key={`c${i}`}
            value={value.cumulatives[i]}
            onChange={(e) => setCum(i, e.target.value.replace(/[^0-9]/g, ""))}
            inputMode="numeric"
            className={cn("h-8 px-1 text-center text-xs")}
            placeholder="0"
            aria-label={`Frame ${i + 1} running total`}
            data-testid={testPrefix ? `${testPrefix}-cum-${i}` : undefined}
          />
        ))}
      </div>
      <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
        Marks: frames 1–9 use <span className="font-mono">X</span> /{" "}
        <span className="font-mono">/</span> / <span className="font-mono">-</span>.
        Frame 10 uses exactly one of{" "}
        <span className="font-mono">XXX · XX · X/ · /X · X · / · -</span>.
        Pin totals live in the running-total row.
      </p>
      {result.errors.length > 0 && (
        <ul className="mt-1 list-disc pl-4 text-[10px] text-destructive">
          {result.errors.slice(0, 4).map((e, idx) => <li key={idx}>{e}</li>)}
        </ul>
      )}
    </div>
  );
}
