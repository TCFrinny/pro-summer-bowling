import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { BowlerRatings, CareerRatings } from "@/lib/ratings";
import { formatRating } from "@/lib/ratings";

interface Props {
  offense: number | null;
  defense: number | null;
  twoWay: number | null;
  quality?: BowlerRatings["quality"];
  details?: BowlerRatings["details"];
  careerContributions?: CareerRatings["contributions"];
}

/** Experimental Offense & Matchup Defense card block. Reuses design
 *  tokens; stacks cleanly on mobile. */
export function RatingsSection(props: Props) {
  const [open, setOpen] = useState(false);
  const { offense, defense, twoWay, quality, details, careerContributions } = props;
  return (
    <section className="mt-8 rounded-lg border border-border bg-card/60 p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg">
          Offense &amp; Matchup Defense
          <span className="ml-2 text-xs uppercase tracking-widest text-muted-foreground">Experimental</span>
        </h2>
        <QualityBadge value={quality ?? (offense != null || defense != null ? "Full" : "Limited sample")} />
      </header>

      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        <RatingCard label="Offensive Rating" value={offense} accent />
        <RatingCard label="Matchup Defense" value={defense} />
        <RatingCard label="Two-Way Rating" value={twoWay} />
      </div>

      {details && (
        <div className="mt-4 grid gap-2 text-[11px] sm:grid-cols-2 md:grid-cols-3">
          <Detail label="Adjusted avg" v={fmt(details.adjustedAverage, 1)} />
          <Detail label="Adj. pins vs league / g" v={fmtSigned(details.adjustedPinsPerGameVsLeague, 1)} />
          <Detail label="Strike %" v={fmtPct(details.strikePct)} />
          <Detail label="Spare conv. %" v={fmtPct(details.spareConversionPct)} />
          <Detail label="Open %" v={fmtPct(details.openPct)} />
          <Detail label="Clutch %" v={fmtPct(details.clutchPct)} />
          <Detail label="Opp. score supp. / g" v={fmtSigned(details.opponentScoreSuppressionPerGame, 1)} />
          <Detail label="Opp. strike supp." v={fmtSigned(details.opponentStrikeSuppressionPct, 1, "%")} />
          <Detail label="Opp. spare-conv supp." v={fmtSigned(details.opponentSpareConversionSuppressionPct, 1, "%")} />
          <Detail label="Opp. open increase" v={fmtSigned(details.opponentOpenIncreasePct, 1, "%")} />
          <Detail label="Opp. clutch supp." v={fmtSigned(details.opponentClutchSuppressionPct, 1, "%")} />
          <Detail label="Actual games" v={details.actualGames.toString()} />
          <Detail label="Full-linescore games" v={details.fullLinescoreGames.toString()} />
          <Detail label="Opponent games" v={details.opponentGames.toString()} />
        </div>
      )}

      {careerContributions && careerContributions.length > 0 && (
        <div className="mt-4 rounded-md border border-border/60 p-3 text-xs">
          <div className="mb-2 font-semibold uppercase tracking-widest text-muted-foreground">Contributing seasons</div>
          <ul className="space-y-1">
            {careerContributions.map((c) => (
              <li key={c.seasonId} className="flex flex-wrap justify-between gap-2">
                <span>{c.seasonLabel ?? c.seasonId}</span>
                <span className="tabular-nums text-muted-foreground">
                  Off {formatRating(c.offense)} · Def {formatRating(c.defense)}
                  {" · "}{c.actualGames}g / {c.opponentGames}opp / {c.fullLinescoreGames}full
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        How these ratings work
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-background/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            Each rating is centered at <strong>100 = season average</strong>. Above 100 is better,
            below 100 is worse. Ratings are standardized within a season (never across
            different eras), sample-shrunk toward the league mean with a conservative
            n / (n + 9) factor, and capped between 50 and 150.
          </p>
          <p>
            <strong>Offensive Rating</strong> combines environment-adjusted scoring (50%),
            strike rate (15%), spare conversion (15%), open avoidance (10%), and clutch
            marks in frames 9–10 (10%). Frame components require canonical
            FULL_LINESCORE data and at least 3 full games; when unavailable the score
            component is reweighted and the rating is labeled Score-based.
          </p>
          <p>
            <strong>Matchup Defense</strong> measures how opponents performed relative to
            their own expected level, adjusted for the scoring environment. It is
            <em> not literal defense</em>; the bowler cannot directly influence what an
            opponent throws, so this metric can still be shaped by schedule and luck.
            Opponent expected scores use a leave-one-opponent-out baseline that
            excludes their games against you.
          </p>
          <p>
            <strong>Two-Way</strong> = 0.70 × Offense + 0.30 × Matchup Defense — weighted
            toward directly attributable offense. Substitute performances belong to the
            substitute; weeks a substitute rolled for a rostered bowler do not count as
            personal games for the scheduled bowler.
          </p>
        </div>
      )}
    </section>
  );
}

function RatingCard({ label, value, accent }: { label: string; value: number | null; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-3xl tabular-nums ${accent ? "text-gold" : ""}`}>
        {formatRating(value)}
      </div>
    </div>
  );
}

function QualityBadge({ value }: { value: BowlerRatings["quality"] }) {
  const cls =
    value === "Full" ? "border-gold/40 bg-gold/10 text-gold" :
    value === "Score-based" ? "border-primary/40 bg-primary/10 text-primary" :
    "border-muted-foreground/40 bg-muted/30 text-muted-foreground";
  return (
    <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-widest ${cls}`} aria-label={`Data quality: ${value}`}>
      {value}
    </span>
  );
}

function Detail({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex justify-between rounded border border-border/40 bg-background/40 px-2 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}

function fmt(v: number | null, digits = 1): string {
  return v == null ? "—" : v.toFixed(digits);
}
function fmtPct(v: number | null): string {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}
function fmtSigned(v: number | null, digits = 1, suffix = ""): string {
  if (v == null) return "—";
  const rounded = Number(v.toFixed(digits));
  if (rounded === 0) return `±0${suffix}`;
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toFixed(digits)}${suffix}`;
}
