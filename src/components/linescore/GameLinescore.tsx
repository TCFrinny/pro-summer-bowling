import type { Frame, GameLinescore as GameLinescoreT } from "@/lib/duckpin";
import { cn } from "@/lib/utils";

/**
 * A single 10-frame duckpin game card, matching the reference site style:
 *   header  : "Game N • Scratch NNN"
 *   frames  : row of 10 boxes. Each box shows
 *               top    : per-ball glyphs (X / - digit)
 *               bottom : cumulative scratch score through that frame
 *   frame 10 is wider to fit the third bonus delivery.
 *
 * Horizontally scrollable on narrow screens — we never crush the boxes.
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

function FrameBox({ frame }: { frame: Frame }) {
  const isTenth = frame.frameNumber === 10;
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-sm border border-border bg-background/70 text-center",
        isTenth ? "w-[68px]" : "w-11 sm:w-12",
      )}
    >
      <div className="border-b border-border/60 bg-accent/40 py-[1px] text-[9px] uppercase tracking-widest text-muted-foreground">
        {frame.frameNumber}
      </div>
      <div
        className={cn(
          "flex items-center justify-center gap-0.5 border-b border-border/60 px-1 py-1 font-display text-sm leading-none tabular-nums",
          frame.isStrike && "text-primary",
          frame.isSpare && "text-gold",
          frame.isOpen && "text-foreground",
        )}
      >
        {frame.ballDisplay.map((glyph, i) => (
          <span
            key={i}
            className={cn(
              "inline-flex h-4 min-w-[10px] items-center justify-center",
              glyph === "-" && "text-muted-foreground",
            )}
          >
            {glyph}
          </span>
        ))}
      </div>
      <div className="py-1 font-display text-sm tabular-nums text-foreground/90">
        {frame.cumulative}
      </div>
    </div>
  );
}
