#!/usr/bin/env node
/**
 * Post-build patch for the generated Cloudflare Worker config.
 *
 * Nitro (cloudflare-module preset) emits `dist/server/wrangler.json`. By
 * default it does NOT include `keep_vars`, which means every
 * `wrangler deploy` wipes any dashboard-managed text environment variables
 * that aren't also declared in the config. That silently removes runtime
 * vars like SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY and breaks server
 * functions after each deploy.
 *
 * This script sets top-level `keep_vars: true` and preserves every other
 * generated field. It exits non-zero on any inconsistency so CI/local
 * builds fail loudly instead of shipping a broken config.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CONFIG_PATH = resolve(process.cwd(), "dist/server/wrangler.json");

export function patchWranglerConfig(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    throw new Error(`wrangler.json is not valid JSON: ${(err instanceof Error ? err.message : String(err))}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("wrangler.json must be a JSON object");
  }
  const before = { ...parsed };
  parsed.keep_vars = true;
  // Preservation check: every original key must still be present with the same value
  // (except keep_vars, which we intentionally set).
  for (const [k, v] of Object.entries(before)) {
    if (k === "keep_vars") continue;
    if (JSON.stringify(parsed[k]) !== JSON.stringify(v)) {
      throw new Error(`patch dropped or mutated field '${k}'`);
    }
  }
  if (parsed.keep_vars !== true) {
    throw new Error("patch verification failed: keep_vars is not true");
  }
  return parsed;
}

function main() {
  if (!existsSync(CONFIG_PATH)) {
    console.error(`[patch-cloudflare-config] ERROR: ${CONFIG_PATH} not found. Did the Nitro build run?`);
    process.exit(1);
  }
  const source = readFileSync(CONFIG_PATH, "utf8");
  let patched;
  try {
    patched = patchWranglerConfig(source);
  } catch (err) {
    console.error(`[patch-cloudflare-config] ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  writeFileSync(CONFIG_PATH, JSON.stringify(patched, null, 2) + "\n");
  // Re-read to verify on disk.
  const verify = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  if (verify.keep_vars !== true) {
    console.error("[patch-cloudflare-config] ERROR: post-write verification failed");
    process.exit(1);
  }
  console.log("[patch-cloudflare-config] keep_vars: true confirmed in dist/server/wrangler.json");
}

// Only run when executed directly (not when imported by tests).
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) main();
