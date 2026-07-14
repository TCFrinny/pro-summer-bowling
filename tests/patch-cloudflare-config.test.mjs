/**
 * Deterministic test for scripts/patch-cloudflare-config.mjs.
 * Verifies keep_vars is added, existing fields survive, and malformed
 * input is rejected.
 */
import { patchWranglerConfig } from "../scripts/patch-cloudflare-config.mjs";

const sample = {
  name: "tanstack-start-ts",
  main: "index.mjs",
  compatibility_date: "2026-07-14",
  compatibility_flags: ["nodejs_compat"],
  assets: { binding: "ASSETS", directory: "../client" },
  no_bundle: true,
  rules: [{ type: "ESModule", globs: ["**/*.mjs", "**/*.js"] }],
};

const patched = patchWranglerConfig(JSON.stringify(sample));

if (patched.keep_vars !== true) {
  throw new Error("patch did not set keep_vars: true");
}
for (const [k, v] of Object.entries(sample)) {
  if (JSON.stringify(patched[k]) !== JSON.stringify(v)) {
    throw new Error(`field '${k}' was mutated or dropped`);
  }
}

// Idempotent: running again yields the same result.
const twice = patchWranglerConfig(JSON.stringify(patched));
if (twice.keep_vars !== true || JSON.stringify(twice) !== JSON.stringify(patched)) {
  throw new Error("patch is not idempotent");
}

// Malformed JSON rejected.
let threw = false;
try { patchWranglerConfig("{not json"); } catch { threw = true; }
if (!threw) throw new Error("malformed JSON should throw");

// Non-object rejected.
threw = false;
try { patchWranglerConfig("[1,2,3]"); } catch { threw = true; }
if (!threw) throw new Error("non-object JSON should throw");

// eslint-disable-next-line no-console
console.log("patch-cloudflare-config self-test passed");
