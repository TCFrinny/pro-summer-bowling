#!/usr/bin/env node
/**
 * Post-build patch for the generated Cloudflare Worker config.
 *
 * Nitro (cloudflare-module preset) emits the Wrangler config for the built
 * Worker. Depending on Nitro version the output lives at either
 * `.output/server/wrangler.json` (current) or `dist/server/wrangler.json`
 * (legacy). By default neither includes `keep_vars: true`, which means
 * every `wrangler deploy` wipes any dashboard-managed text environment
 * variables that aren't also declared in the config. That silently removes
 * runtime vars like SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY and breaks
 * server functions after each deploy.
 *
 * This script sets top-level `keep_vars: true` and preserves every other
 * generated field. It exits non-zero on any inconsistency so CI/local
 * builds fail loudly instead of shipping a broken config.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Candidate paths in preference order. `.output/...` is the current Nitro
// shape; `dist/...` is kept for older/local build layouts.
const CANDIDATE_PATHS = [
  ".output/server/wrangler.json",
  "dist/server/wrangler.json",
];

export const PINNED_WORKER_NAME = "pro-summer-bowling";

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
  parsed.name = PINNED_WORKER_NAME;
  // Preservation check: every original key must still be present with the same value
  // except the two we intentionally mutate (keep_vars, name).
  for (const [k, v] of Object.entries(before)) {
    if (k === "keep_vars" || k === "name") continue;
    if (JSON.stringify(parsed[k]) !== JSON.stringify(v)) {
      throw new Error(`patch dropped or mutated field '${k}'`);
    }
  }
  if (parsed.keep_vars !== true) {
    throw new Error("patch verification failed: keep_vars is not true");
  }
  if (parsed.name !== PINNED_WORKER_NAME) {
    throw new Error(`patch verification failed: name is not '${PINNED_WORKER_NAME}'`);
  }
  return parsed;
}

/**
 * Resolve which Wrangler config to patch. Prefers `.output/server/wrangler.json`
 * (current Nitro output), falls back to `dist/server/wrangler.json`.
 * If `.wrangler/deploy/config.json` exists and points at an existing file,
 * that path is honored as an additional preferred candidate.
 */
export function resolveConfigPath(cwd, existsFn = existsSync) {
  // Honor .wrangler/deploy/config.json if it references an existing file.
  const deployPointer = resolve(cwd, ".wrangler/deploy/config.json");
  if (existsFn(deployPointer)) {
    try {
      const pointer = JSON.parse(readFileSync(deployPointer, "utf8"));
      const configPath = pointer && typeof pointer.config === "string" ? pointer.config : null;
      if (configPath) {
        const abs = resolve(cwd, ".wrangler/deploy", configPath);
        if (existsFn(abs)) return abs;
      }
    } catch {
      // Ignore malformed pointer; fall through to candidates.
    }
  }
  for (const rel of CANDIDATE_PATHS) {
    const abs = resolve(cwd, rel);
    if (existsFn(abs)) return abs;
  }
  return null;
}

function main() {
  const cwd = process.cwd();
  const configPath = resolveConfigPath(cwd);
  if (!configPath) {
    console.error(
      `[patch-cloudflare-config] ERROR: no Wrangler config found. Looked for: ${CANDIDATE_PATHS
        .map((p) => resolve(cwd, p))
        .join(", ")}. Did the Nitro build run?`,
    );
    process.exit(1);
  }
  const source = readFileSync(configPath, "utf8");
  let patched;
  try {
    patched = patchWranglerConfig(source);
  } catch (err) {
    console.error(`[patch-cloudflare-config] ERROR at ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  writeFileSync(configPath, JSON.stringify(patched, null, 2) + "\n");
  const verify = JSON.parse(readFileSync(configPath, "utf8"));
  if (verify.keep_vars !== true) {
    console.error(`[patch-cloudflare-config] ERROR: post-write verification failed (keep_vars) at ${configPath}`);
    process.exit(1);
  }
  if (verify.name !== PINNED_WORKER_NAME) {
    console.error(`[patch-cloudflare-config] ERROR: post-write verification failed (name != '${PINNED_WORKER_NAME}') at ${configPath}`);
    process.exit(1);
  }
  console.log(`[patch-cloudflare-config] patched ${configPath}`);
  console.log(`[patch-cloudflare-config]   keep_vars: true confirmed`);
  console.log(`[patch-cloudflare-config]   name: "${PINNED_WORKER_NAME}" confirmed`);
}

// Only run when executed directly (not when imported by tests).
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) main();

// Only run when executed directly (not when imported by tests).
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect) main();
