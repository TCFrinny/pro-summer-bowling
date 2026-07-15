/**
 * Source-level assertions for the admin-only "Rebuild Snapshot" control.
 *
 * We can't render React in the deterministic runner, so we grep the source
 * to prove the wiring rules hold:
 *   - admin.tsx imports rebuildCurrentSeasonSnapshot from league-repo.functions
 *   - it invalidates the public snapshot cache using the exported
 *     SNAPSHOT_QUERY_KEY (no ad-hoc second key)
 *   - the control lives inside AdminHeaderBar which is only rendered from
 *     the gate.kind === "admin" branch
 *   - the server function rebuildCurrentSeasonSnapshot uses
 *     requireSupabaseAuth + ensureAdmin and calls the cheap
 *     rebuildAndSaveSnapshot (bounds-only) — never computeElimination
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const admin = readFileSync(join(ROOT, "src/routes/admin.tsx"), "utf8");
const repo = readFileSync(join(ROOT, "src/lib/league-repo.functions.ts"), "utf8");
const snapshotBuilder = readFileSync(
  join(ROOT, "src/lib/snapshot-builder.server.ts"),
  "utf8",
);

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`admin-rebuild-snapshot: ${msg}`);
}

// 1. Wiring — imports & usage.
assert(
  /from\s+["']@\/lib\/league-repo\.functions["']/.test(admin) &&
    /rebuildCurrentSeasonSnapshot/.test(admin),
  "admin.tsx must import rebuildCurrentSeasonSnapshot from @/lib/league-repo.functions",
);
assert(
  /await\s+rebuildCurrentSeasonSnapshot\s*\(/.test(admin),
  "admin.tsx must invoke rebuildCurrentSeasonSnapshot()",
);

// 2. Invalidation uses the shared public snapshot key export.
assert(
  /SNAPSHOT_QUERY_KEY/.test(admin) &&
    /from\s+["']@\/lib\/public-snapshot["']/.test(admin),
  "admin.tsx must import SNAPSHOT_QUERY_KEY from @/lib/public-snapshot",
);
assert(
  /invalidateQueries\s*\(\s*\{\s*queryKey:\s*SNAPSHOT_QUERY_KEY\s*\}\s*\)/.test(
    admin,
  ),
  "admin.tsx must invalidate the public snapshot query via SNAPSHOT_QUERY_KEY",
);

// 3. UI copy: label + progress + success message.
assert(/Rebuild Snapshot/.test(admin), "button label 'Rebuild Snapshot' missing");
assert(/Rebuilding…/.test(admin), "progress label 'Rebuilding…' missing");
assert(/Snapshot rebuilt\./.test(admin), "success message 'Snapshot rebuilt.' missing");

// 4. Admin-gated placement — the button lives in AdminHeaderBar, and
//    AdminHeaderBar is only rendered in the return branch that runs when
//    gate.kind === "admin" (after the not-admin/loading branches early-return).
assert(
  /function\s+AdminHeaderBar\b/.test(admin),
  "AdminHeaderBar component must exist",
);
assert(
  /<AdminHeaderBar\b/.test(admin),
  "admin.tsx must render <AdminHeaderBar />",
);
const notAdminIdx = admin.indexOf('gate.kind === "not-admin"');
const adminBarIdx = admin.indexOf("<AdminHeaderBar");
assert(
  notAdminIdx > -1 && adminBarIdx > notAdminIdx,
  "<AdminHeaderBar /> must be rendered AFTER the not-admin early-return branch (admin-only)",
);

// 5. Server function security & bounds-only guarantee.
assert(
  /export\s+const\s+rebuildCurrentSeasonSnapshot\s*=\s*createServerFn/.test(repo),
  "rebuildCurrentSeasonSnapshot must be a createServerFn",
);
const rebuildBlockMatch = repo.match(
  /export\s+const\s+rebuildCurrentSeasonSnapshot[\s\S]+?\}\);/,
);
assert(rebuildBlockMatch, "could not locate rebuildCurrentSeasonSnapshot body");
const rebuildBlock = rebuildBlockMatch[0];
assert(
  /\.middleware\(\s*\[\s*requireSupabaseAuth\s*\]\s*\)/.test(rebuildBlock),
  "rebuildCurrentSeasonSnapshot must use requireSupabaseAuth middleware",
);
assert(
  /ensureAdmin\(context\)/.test(rebuildBlock),
  "rebuildCurrentSeasonSnapshot must call ensureAdmin(context)",
);
assert(
  /rebuildSnapshot\(context,\s*seasonId\)/.test(rebuildBlock),
  "rebuildCurrentSeasonSnapshot must call the cheap rebuildSnapshot helper",
);

// The cheap rebuild path must NOT run the full elimination solver on the
// server. computeElimination() lives in the browser worker only.
assert(
  !/computeElimination\s*\(/.test(snapshotBuilder),
  "snapshot builder must not call computeElimination() (server-side CPU limit)",
);
assert(
  !/computeElimination\s*\(/.test(repo),
  "league-repo server functions must not call computeElimination()",
);

// eslint-disable-next-line no-console
console.log("admin-rebuild-snapshot assertions passed");
