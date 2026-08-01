/**
 * Deterministic self-tests runner.
 *
 * Importing these modules executes their module-load `selfTest` IIFEs,
 * which throw on any regression. Run with `bun run test:deterministic`.
 */
import "../src/lib/frame-input";
import "./duckpin-tenth-marks";
import "../src/lib/league-store";
import "../src/lib/person-sort";
import "./person-sort";
import "../src/lib/roster-adapter";
import "../src/lib/elimination-order";
import "../src/lib/substitute-handicap";
import "./checkpoint-3b-hardening";
import "./week-patch-preservation";
import "./absent-scoring";
import "./elimination";
import "./substitute-profiles";
import "./elimination-bounds";
import "./elimination-auto-run";
import "./frame-input-messages";
import "./standings-movement";
import "./admin-rebuild-snapshot";
import "./schedule-default-week";
import "./live-scoring";
import "./live-scoring-elim-capacity";
import "./live-scoring-backward-safety";
import "./live-scoring-substitute";
import "./season-history";
import "./multi-season-phase";
import "./lane-pair-order";
import "./weekly-results-lane-order";
import "./historical-phase";
import "./historical-phase-hardening";
import "./historical-phase-final";
import "./historical-override-semantics";
import "./historical-privacy-migration";
import "./seasons-layout-outlet";
import "./career-advanced";
import "./career-records";
import "./ratings";
import "./champion-and-rebuild";
import "./leaderboards";
import "./leaderboards-hdcp-cap";





// @ts-expect-error - JS module without types
import "./patch-cloudflare-config.test.mjs";


// eslint-disable-next-line no-console
console.log("deterministic self-tests passed");



// eslint-disable-next-line no-console
console.log("deterministic self-tests passed");
