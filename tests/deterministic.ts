/**
 * Deterministic self-tests runner.
 *
 * Importing these modules executes their module-load `selfTest` IIFEs,
 * which throw on any regression. Run with `bun run test:deterministic`.
 */
import "../src/lib/frame-input";
import "../src/lib/league-store";
import "../src/lib/roster-adapter";
import "./checkpoint-3b-hardening";


// eslint-disable-next-line no-console
console.log("deterministic self-tests passed");
