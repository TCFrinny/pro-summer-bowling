/**
 * Regression: `/seasons` must be a layout route rendering <Outlet /> so that
 * `/seasons/$seasonId/...` archived children mount. The list page must live
 * in the `/seasons/` index route.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const layout = readFileSync(resolve("src/routes/seasons.tsx"), "utf8");
const index = readFileSync(resolve("src/routes/seasons.index.tsx"), "utf8");

if (!/createFileRoute\(["']\/seasons["']\)/.test(layout)) {
  throw new Error("seasons.tsx must declare createFileRoute('/seasons')");
}
if (!/<Outlet\s*\/>/.test(layout)) {
  throw new Error("seasons.tsx (layout) must render <Outlet />");
}
if (/listPublicSeasons|SeasonCard|SeasonsList/.test(layout)) {
  throw new Error("seasons.tsx must not contain the list page logic — move it to seasons.index.tsx");
}

if (!/createFileRoute\(["']\/seasons\/["']\)/.test(index)) {
  throw new Error("seasons.index.tsx must declare createFileRoute('/seasons/')");
}
if (!/listPublicSeasons/.test(index) || !/SeasonCard/.test(index)) {
  throw new Error("seasons.index.tsx must contain the public seasons list");
}

// eslint-disable-next-line no-console
console.log("seasons-layout-outlet test passed");
