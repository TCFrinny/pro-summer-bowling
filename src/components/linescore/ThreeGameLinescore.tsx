import type { BowlerMatchLinescore } from "@/lib/mock-data";
import { GameLinescore } from "./GameLinescore";

/**
 * Three stacked game cards for one bowler in one match. Frame cards show only
 * the saved mark + running cumulative — the model contains no per-ball data.
 */
export function ThreeGameLinescore({
  linescore,
}: {
  linescore: BowlerMatchLinescore;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground">
        <span>{linescore.actualName}</span>
        {linescore.isSub && (
          <span className="rounded bg-primary/25 px-1.5 py-0.5 text-[9px] font-semibold text-primary">
            substitute
          </span>
        )}
        <span>· entry {linescore.entryAverage}</span>
        <span>· hdcp +{linescore.handicap}</span>
        <span className="ml-auto text-gold">
          Set {linescore.scratchSet} · Hdcp {linescore.handicapSet}
        </span>
      </div>
      <div className="grid gap-2">
        {linescore.games.map((g, i) => (
          <div key={i} className="space-y-1">
            <GameLinescore game={g} index={i} />
            <div className="pl-2 text-[10px] uppercase tracking-widest text-muted-foreground">
              Hdcp game <span className="text-gold">{linescore.handicapGames[i]}</span>
              {" · "}{g.strikes}X {g.spares}/ {g.opens}O
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
