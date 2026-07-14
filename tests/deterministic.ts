/**
 * Deterministic self-tests runner.
 *
 * Importing these modules executes their module-load `selfTest` IIFEs,
 * which throw on any regression. Run with `bun run test:deterministic`.
 */
import "../src/lib/frame-input";
import "../src/lib/league-store";
import "../src/lib/roster-adapter";
import "../src/lib/elimination-order";
import "../src/lib/substitute-handicap";
import "./checkpoint-3b-hardening";
import "./week-patch-preservation";
import "./absent-scoring";
import "./elimination";
import "./elimination-bounds";
import "./elimination-auto-run";
import "./frame-input-messages";
// @ts-expect-error - JS module without types
import "./patch-cloudflare-config.test.mjs";


// eslint-disable-next-line no-console
console.log("deterministic self-tests passed");



// eslint-disable-next-line no-console
console.log("deterministic self-tests passed");
