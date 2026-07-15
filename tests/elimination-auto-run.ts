/**
 * Deterministic tests for the elimination auto-run UX helpers.
 *
 * These cover pure eligibility + display logic used by the /elimination
 * route so we can guarantee:
 *   - auto-run fires only for signed-in admins in bounds_only mode
 *   - one launch per builtAt
 *   - full mode never triggers a launch
 *   - "Pending Full Calculation" label appears only in bounds_only mode
 *   - server rebuild path does not import the full solver
 */

import { readFileSync } from "node:fs";
import {
  boundsNoticeCopy,
  displayLabelForStatus,
  holdingCardCopy,
  shouldAutoRunFull,
  shouldShowFullResults,
  type AutoRunEligibilityInput,
} from "../src/lib/elimination-auto-run";

function expect(cond: unknown, msg: string): void {
  if (!cond) throw new Error("elimination-auto-run test failed: " + msg);
}

const base: AutoRunEligibilityInput = {
  isAdmin: true,
  adminCheckPending: false,
  mode: "bounds_only",
  builtAt: 1001,
  lastAutoRunBuiltAt: null,
  phase: "idle",
};

// --- 1. Happy path: admin + bounds_only + fresh builtAt ---------------
expect(shouldAutoRunFull(base) === true, "eligible in the happy path");

// --- 2. Not admin → no auto-run --------------------------------------
expect(
  shouldAutoRunFull({ ...base, isAdmin: false }) === false,
  "non-admin must NOT auto-run",
);

// --- 3. Admin check pending → no auto-run ----------------------------
expect(
  shouldAutoRunFull({ ...base, adminCheckPending: true }) === false,
  "admin check pending blocks auto-run",
);

// --- 4. Full mode → no auto-run --------------------------------------
expect(
  shouldAutoRunFull({ ...base, mode: "full" }) === false,
  "full mode must NOT auto-run",
);

// --- 5. No snapshot loaded → no auto-run -----------------------------
expect(
  shouldAutoRunFull({ ...base, builtAt: null }) === false,
  "missing snapshot blocks auto-run",
);

// --- 6. Already ran for this builtAt → no auto-run -------------------
expect(
  shouldAutoRunFull({ ...base, lastAutoRunBuiltAt: 1001 }) === false,
  "one launch per builtAt",
);

// --- 7. New builtAt after a prior launch → auto-run again ------------
expect(
  shouldAutoRunFull({ ...base, lastAutoRunBuiltAt: 1000 }) === true,
  "new builtAt must be eligible again",
);

// --- 8. Running / saving phase → no auto-run -------------------------
expect(shouldAutoRunFull({ ...base, phase: "running" }) === false, "running blocks auto-run");
expect(shouldAutoRunFull({ ...base, phase: "saving" }) === false, "saving blocks auto-run");

// --- 9. After error, same builtAt does NOT retry (manual only) -------
expect(
  shouldAutoRunFull({ ...base, phase: "error", lastAutoRunBuiltAt: 1001 }) === false,
  "error at same builtAt must require manual retry",
);

// --- 10. Display label overrides only for bounds_only + not_proven ---
expect(
  displayLabelForStatus("not_proven", "bounds_only", "Not Proven Within Limit")
    === "Pending Full Calculation",
  "bounds_only + not_proven → Pending Full Calculation",
);
expect(
  displayLabelForStatus("not_proven", "full", "Not Proven Within Limit")
    === "Not Proven Within Limit",
  "full + not_proven → keep canonical label",
);
expect(
  displayLabelForStatus("alive", "bounds_only", "Alive") === "Alive",
  "bounds_only + alive → unchanged",
);
expect(
  displayLabelForStatus("clinched", "bounds_only", "Proven Clinched")
    === "Proven Clinched",
  "bounds_only + clinched → unchanged",
);
expect(
  displayLabelForStatus("eliminated", "bounds_only", "Proven Eliminated")
    === "Proven Eliminated",
  "bounds_only + eliminated → unchanged",
);

// --- 11. Notice copy varies by viewer + phase ------------------------
{
  const admin = boundsNoticeCopy({
    mode: "bounds_only", isAdmin: true, phase: "idle",
    lastCalculatedAt: new Date(0).toISOString(),
  });
  expect(
    admin.detail === "Full calculation is starting automatically for administrators.",
    "admin idle detail",
  );

  const adminRunning = boundsNoticeCopy({
    mode: "bounds_only", isAdmin: true, phase: "running",
    lastCalculatedAt: new Date(0).toISOString(),
  });
  expect(
    adminRunning.detail === "Calculating full schedule scenarios in your browser…",
    "admin running detail",
  );

  const adminSaving = boundsNoticeCopy({
    mode: "bounds_only", isAdmin: true, phase: "saving",
    lastCalculatedAt: new Date(0).toISOString(),
  });
  expect(
    adminSaving.detail === "Calculating full schedule scenarios in your browser…",
    "admin saving detail",
  );

  const publicVisitor = boundsNoticeCopy({
    mode: "bounds_only", isAdmin: false, phase: "idle",
    lastCalculatedAt: new Date(0).toISOString(),
  });
  expect(
    /admin calculation is pending/i.test(publicVisitor.detail),
    "public visitor sees neutral pending notice",
  );
  expect(
    !/starting automatically/i.test(publicVisitor.detail),
    "public visitor must NOT be told a calc is starting for them",
  );

  const done = boundsNoticeCopy({
    mode: "full", isAdmin: false, phase: "idle",
    lastCalculatedAt: new Date(0).toISOString(),
  });
  expect(/completed/i.test(done.heading), "full mode heading");
}

// --- 12. Route file uses the auto-run helper and Web Worker ----------
{
  const src = readFileSync("src/routes/elimination.tsx", "utf8");
  expect(src.includes("shouldAutoRunFull"), "route must use shouldAutoRunFull");
  expect(src.includes("displayLabelForStatus"), "route must use displayLabelForStatus");
  expect(
    src.includes("elimination.worker.ts"),
    "route must launch the Web Worker (browser-only)",
  );
  expect(
    !src.includes("computeElimination("),
    "route must NOT invoke the full solver at render time",
  );
}

// --- 13. Server-side snapshot rebuild does NOT import the full solver
{
  const src = readFileSync("src/lib/snapshot-builder.server.ts", "utf8");
  expect(
    !/from ["']@\/lib\/elimination["']/.test(src) && !src.includes("computeElimination("),
    "server-side rebuild must not reintroduce the full solver",
  );
}

// --- 14. Full-results visibility helper ------------------------------
expect(shouldShowFullResults("full") === true, "full mode → show results");
expect(shouldShowFullResults("bounds_only") === false, "bounds_only → hide results");

// --- 15. Holding-card copy is public-safe ----------------------------
{
  const copy = holdingCardCopy();
  expect(/being updated/i.test(copy.heading), "holding heading mentions updating");
  expect(
    !/your browser/i.test(copy.detail) && !/starting automatically/i.test(copy.detail),
    "holding card must not imply the visitor's browser is running the calc",
  );
}

// --- 16. Route hides table in bounds_only and gates admin button -----
{
  const src = readFileSync("src/routes/elimination.tsx", "utf8");
  expect(src.includes("shouldShowFullResults"), "route must gate results with helper");
  expect(src.includes("HoldingCard"), "route must render holding card");
  // Admin controls (Run Full Calculation button) live behind an isAdmin gate
  expect(
    /isAdmin && snapshot &&/.test(src) || /isAdmin &&/.test(src),
    "Run Full Calculation button must be gated by isAdmin",
  );
}

// eslint-disable-next-line no-console
console.log("elimination-auto-run tests passed");
