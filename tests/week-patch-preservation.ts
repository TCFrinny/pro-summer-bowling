/**
 * Focused pure test for the weeks-row patch builder used by
 * upsertWeekRow. Ensures a completed-flag update (or any partial patch)
 * does NOT carry along undefined `published` / `date` keys, which
 * guarantees a subsequent Supabase PATCH cannot regress those columns.
 */
import { __buildWeekPatchForTest } from "../src/lib/schedule-repo.functions";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error("assertion failed: " + msg);
}

// completed-only update (saveMatchResult / deleteMatchResult path)
{
  const p = __buildWeekPatchForTest({ completed: true });
  assert(Object.keys(p).length === 1, "completed-only patch must have exactly one key");
  assert("completed" in p && p.completed === true, "completed present");
  assert(!("published" in p), "published must not be present when undefined");
  assert(!("date" in p), "date must not be present when undefined");
}

// publish-only update (setWeekPublished true)
{
  const p = __buildWeekPatchForTest({ published: true });
  assert(Object.keys(p).length === 1 && p.published === true, "published-only patch");
}

// unpublish (explicit false must be forwarded, not stripped)
{
  const p = __buildWeekPatchForTest({ published: false });
  assert("published" in p && p.published === false, "explicit false must be forwarded");
}

// schedule save with publish=undefined must NOT touch published
{
  const p = __buildWeekPatchForTest({ date: "2026-06-04", published: undefined });
  assert("date" in p && p.date === "2026-06-04", "date preserved");
  assert(!("published" in p), "undefined published must be stripped");
}

// explicit null date (admin cleared it) is preserved
{
  const p = __buildWeekPatchForTest({ date: null });
  assert("date" in p && p.date === null, "null date must be preserved");
}

// eslint-disable-next-line no-console
console.log("week-patch-preservation: ok");
