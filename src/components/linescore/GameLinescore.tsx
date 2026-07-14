import type { FrameLinescore, GameLinescore as GameLinescoreT } from "@/lib/duckpin";
import { classifyFrame } from "@/lib/duckpin";
import { cn } from "@/lib/utils";

/**
 * A single 10-frame duckpin game card. Displays ONLY the saved data:
 *   - frame number
 *   - frame mark (X / spare / open, plus tenth-frame combo)
 *   - running cumulative scratch score
 * No individual ball boxes or pin counts — the saved model contains none.
 * Frame 10 is wider to fit the tenth-frame mark string. Horizontally
 * scrollable on narrow screens.
 */
export function GameLinescore({
  game,
  index,
  className,
}: {
  game: GameLinescoreT;
  /** 0-based game index in the set (0..2). */
  index: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-md border border-border bg-card/60 p-2 sm:p-3",
        className,
      )}
    >
      <div className="mb-2 flex items-baseline justify-between px-1">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Game {index + 1}
        </div>
        <div className="font-display text-sm text-gold">
          Scratch <span className="text-lg">{game.scratchTotal}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-w-max gap-1">
          {game.frames.map((f) => (
            <FrameBox key={f.frameNumber} frame={f} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FrameBox({ frame }: { frame: FrameLinescore }) {
  const isTenth = frame.frameNumber === 10;
  const cls = classifyFrame(frame.frameNumber, frame.mark);
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-sm border border-border bg-background/70 text-center",
        isTenth ? "w-[72px]" : "w-11 sm:w-12",
      )}
    >
      <div className="border-b border-border/60 bg-accent/40 py-[1px] text-[9px] uppercase tracking-widest text-muted-foreground">
        {frame.frameNumber}
      </div>
      <div
        className={cn(
          "flex items-center justify-center border-b border-border/60 px-1 py-1 font-display text-sm leading-none tabular-nums",
          cls === "strike" && "text-primary",
          cls === "spare" && "text-gold",
          cls === "open" && "text-muted-foreground",
        )}
      >
        {frame.mark}
      </div>
      <div className="py-1 font-display text-sm tabular-nums text-foreground/90">
        {frame.cumulativeScore}
      </div>
    </div>
  );
}
