/**
 * Deterministic test for scripts/patch-cloudflare-config.mjs.
 * Verifies keep_vars is added, existing fields survive, malformed
 * input is rejected, and the correct config path is selected
 * (.output preferred over dist).
 */
import { patchWranglerConfig, resolveConfigPath, PINNED_WORKER_NAME } from "../scripts/patch-cloudflare-config.mjs";
import { resolve } from "node:path";

const AUTO_NAME = "tcfrinny-pro-summer-bowling";
const sample = {
  name: AUTO_NAME,
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
if (patched.name !== "pro-summer-bowling") {
  throw new Error(`patch did not pin name to 'pro-summer-bowling', got '${patched.name}'`);
}
if (PINNED_WORKER_NAME !== "pro-summer-bowling") {
  throw new Error("PINNED_WORKER_NAME export drifted");
}
for (const [k, v] of Object.entries(sample)) {
  if (k === "name") continue; // intentionally overwritten
  if (JSON.stringify(patched[k]) !== JSON.stringify(v)) {
    throw new Error(`field '${k}' was mutated or dropped`);
  }
}

// Idempotent: running again yields the same result (name stays pinned).
const twice = patchWranglerConfig(JSON.stringify(patched));
if (twice.keep_vars !== true || twice.name !== "pro-summer-bowling" || JSON.stringify(twice) !== JSON.stringify(patched)) {
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

// --- Path resolution tests ---
const cwd = "/repo";
const outputAbs = resolve(cwd, ".output/server/wrangler.json");
const distAbs = resolve(cwd, "dist/server/wrangler.json");

// .output preferred when both exist.
{
  const exists = (p) => p === outputAbs || p === distAbs;
  const got = resolveConfigPath(cwd, exists);
  if (got !== outputAbs) throw new Error(`expected .output preferred, got ${got}`);
}

// Falls back to dist when only dist exists.
{
  const exists = (p) => p === distAbs;
  const got = resolveConfigPath(cwd, exists);
  if (got !== distAbs) throw new Error(`expected dist fallback, got ${got}`);
}

// Returns null when neither exists.
{
  const got = resolveConfigPath(cwd, () => false);
  if (got !== null) throw new Error(`expected null when nothing found, got ${got}`);
}

// Only .output exists.
{
  const exists = (p) => p === outputAbs;
  const got = resolveConfigPath(cwd, exists);
  if (got !== outputAbs) throw new Error(`expected .output only, got ${got}`);
}

// eslint-disable-next-line no-console
console.log("patch-cloudflare-config self-test passed");
