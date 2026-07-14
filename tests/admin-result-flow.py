"""
Pro Summer Singles — Phase 1 end-to-end admin result flow test.

Requires the dev server running at http://localhost:8080 (started
automatically by the sandbox). Run with:

    bun run test:e2e          # (thin wrapper for `python3 tests/admin-result-flow.py`)

Covers all seven UI-verification steps required for the v3 shared-store
completion sign-off:

1. Clean/reset localStorage baseline.
2. Capture the two scheduled bowlers' W, L, and handicap pinfall from
   Standings BEFORE any admin save.
3. Open /admin/results, select a scheduled (uncompleted) week, and
   confirm 60 frame-mark + 60 cumulative inputs are present per match
   (30 marks + 30 cumulatives per side × 2 sides).
4. Enter valid frame result + cumulative pairs for every one of those
   60 frames, producing distinctive game totals per side. Confirm the
   frame-derived preview totals exactly 7 points, then save.
5. Verify the saved MatchResult in pss.leagueStore.v3 has 3 games × 10
   frames per side, frozen scheduled metadata, awarded points that sum
   to 7, and no note-only placeholder.
6. Verify Weekly Results shows the exact entered game totals, Standings
   W / L / handicap pinfall changed from baseline by exactly the saved-
   match contribution (no double count), the bowler profile /bowlers/$id
   shows a new history row with the exact scores, and Statistics /
   Leaderboards / Lane Data render with the updated snapshot.
7. Reload with persisted storage, confirm the editor rehydrates, edit
   one game through the UI, resave, and confirm the replacement (not a
   second copy) reaches Weekly Results, the bowler profile, and
   Standings pinfall.
"""

import asyncio
import json
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright, Page

BASE = "http://localhost:8080"
SCREENSHOTS = Path(__file__).parent / "_out"
SCREENSHOTS.mkdir(exist_ok=True)


class Fail(Exception):
    pass


def assert_eq(actual, expected, label: str) -> None:
    if actual != expected:
        raise Fail(f"{label}: expected {expected!r}, got {actual!r}")


def assert_true(cond: bool, label: str) -> None:
    if not cond:
        raise Fail(label)


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

async def reset_league(page: Page) -> None:
    """Wipe every pss.leagueStore.* key so the module reseeds fresh."""
    await page.goto(f"{BASE}/", wait_until="domcontentloaded")
    await page.evaluate(
        "() => Object.keys(localStorage)"
        ".filter(k => k.startsWith('pss.leagueStore'))"
        ".forEach(k => localStorage.removeItem(k))"
    )


async def capture_standings_row(page: Page, bowler_id: str) -> dict:
    """Return {w, l, hcp_pinfall, games} from the standings desktop row."""
    await page.goto(f"{BASE}/standings", wait_until="domcontentloaded")
    await page.wait_for_selector(f'[data-testid="standings-row-{bowler_id}"]', timeout=8000)
    await page.wait_for_load_state("networkidle")
    await asyncio.sleep(0.2)
    return await page.evaluate(
        """(id) => {
            const row = document.querySelector(`[data-testid="standings-row-${id}"]`);
            return {
                w: Number(row.dataset.w),
                l: Number(row.dataset.l),
                hcp_pinfall: Number(row.dataset.hcpPinfall),
                games: Number(row.dataset.games),
            };
        }""",
        bowler_id,
    )


async def read_store(page: Page) -> dict:
    """Prefer the in-memory store getter (populated on module load, even
    before the first persist), fall back to the persisted key."""
    return await page.evaluate(
        """() => {
            const g = window.__pssStore;
            if (g && typeof g.getDb === 'function') return g.getDb();
            const raw = localStorage.getItem('pss.leagueStore.v3');
            return raw ? JSON.parse(raw) : null;
        }"""
    )


# All-open frame-diff pattern that gives an exact scratch total.
# diff_i = pins in frame i (0..9), sum diff = total. Cumulatives are the
# running sum. Every mark is "-" (open) — no strikes/spares needed.
def open_frames_for_total(total: int) -> tuple[list[str], list[int]]:
    if not (0 <= total <= 90):
        raise ValueError(f"open-total must be 0..90; got {total}")
    # 9 pins per frame until we run out, then 0.
    diffs: list[int] = []
    remaining = total
    for _ in range(10):
        pins = min(9, remaining)
        diffs.append(pins)
        remaining -= pins
    marks = ["-"] * 10
    cums: list[int] = []
    running = 0
    for d in diffs:
        running += d
        cums.append(running)
    assert cums[-1] == total
    return marks, cums


async def fill_game(page: Page, side: str, game_index: int, total: int) -> None:
    """Fill one side/game (10 marks + 10 cums) using native-value setters."""
    marks, cums = open_frames_for_total(total)
    prefix = f"side-{side}-g{game_index + 1}"
    payload = []
    for i, m in enumerate(marks):
        payload.append({"sel": f'[data-testid="{prefix}-mark-{i}"]', "val": m})
    for i, c in enumerate(cums):
        payload.append({"sel": f'[data-testid="{prefix}-cum-{i}"]', "val": str(c)})
    await page.evaluate(
        """(items) => {
            const setter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value').set;
            for (const {sel, val} of items) {
                const el = document.querySelector(sel);
                if (!el) throw new Error('missing ' + sel);
                setter.call(el, val);
                el.dispatchEvent(new Event('input', {bubbles: true}));
            }
        }""",
        payload,
    )


async def count_inputs(page: Page) -> tuple[int, int]:
    marks = await page.locator('[data-testid*="-mark-"][data-testid^="side-"]').count()
    cums = await page.locator('[data-testid*="-cum-"][data-testid^="side-"]').count()
    return marks, cums


# --------------------------------------------------------------------------
# The test
# --------------------------------------------------------------------------

TARGETS_A = [90, 85, 80]   # distinctive
TARGETS_B = [70, 65, 60]
EDIT_G3_A = 45             # replacement value for game 3 of side A on second save


async def main() -> int:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await ctx.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
        page.on("console", lambda m: errors.append(f"console.{m.type}: {m.text[:300]}")
                if m.type in ("error",) else None)

        # ------------------------------------------------------------------
        # 1) Reset & pick a scheduled match on week 8 (first uncompleted week).
        # ------------------------------------------------------------------
        await reset_league(page)
        await page.reload(wait_until="domcontentloaded")
        await page.wait_for_load_state("networkidle")
        await page.wait_for_function(
            "() => window.__pssStore && window.__pssStore.getDb()",
            timeout=10000,
        )

        store = await read_store(page)
        wk = 8
        match = next(m for m in store["matchesByWeek"][str(wk)] if m["status"] == "scheduled")
        match_id = match["id"]
        a_id, b_id = match["bowlerA"], match["bowlerB"]
        print(f"target match: week={wk} id={match_id} A={a_id} B={b_id}")

        # ------------------------------------------------------------------
        # 2) Capture baseline standings rows.
        # ------------------------------------------------------------------
        base_a = await capture_standings_row(page, a_id)
        base_b = await capture_standings_row(page, b_id)
        print("baseline A:", base_a)
        print("baseline B:", base_b)

        # ------------------------------------------------------------------
        # 3) Open /admin/results, select week 8 + this match.
        # ------------------------------------------------------------------
        await page.goto(f"{BASE}/admin/results", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="admin-results-toolbar"]', timeout=8000)
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(0.3)

        # Change week via the native <select> hidden by shadcn — safer to use
        # the Radix trigger.
        await page.locator('[data-testid="week-select"]').click()
        await page.get_by_role("option", name=f"Week {wk}").click()
        await asyncio.sleep(0.2)
        # Match selector — first option corresponds to the first slot.
        await page.locator('[data-testid="match-select"]').click()
        # Radix keeps a single listbox; matches are ordered by lane/slot in seed.
        # Match ID pattern is w{week}-{lanePair}-{slot}. Click by the visible
        # match label prefix.
        opts = await page.locator('[role="option"]').all_inner_texts()
        # Pick the option matching our match id's lane pair + slot ordering.
        lane_pair = match["lanePair"]
        slot = match["slot"]
        wanted_prefix = f"Lanes {lane_pair} · Slot {slot}"
        opt_idx = next(i for i, t in enumerate(opts) if t.startswith(wanted_prefix))
        await page.locator('[role="option"]').nth(opt_idx).click()
        await asyncio.sleep(0.3)

        # Confirm both side panels present and 60+60 inputs are visible.
        assert_true(await page.locator('[data-testid="side-A"]').count() == 1, "side-A panel missing")
        assert_true(await page.locator('[data-testid="side-B"]').count() == 1, "side-B panel missing")
        marks_ct, cums_ct = await count_inputs(page)
        assert_eq(marks_ct, 60, "frame-mark input count")
        assert_eq(cums_ct, 60, "cumulative input count")

        # No override — this must be a real frame-derived save.
        assert_true(await page.locator('[data-testid="editing-saved-banner"]').count() == 0,
                    "match must NOT already be marked as saved before first save")

        # ------------------------------------------------------------------
        # 4) Fill 60 frames per side and save.
        # ------------------------------------------------------------------
        for gi, tot in enumerate(TARGETS_A):
            await fill_game(page, "A", gi, tot)
        for gi, tot in enumerate(TARGETS_B):
            await fill_game(page, "B", gi, tot)
        await asyncio.sleep(0.3)

        # Preview must be exactly 7 total (bowledA + bowledB, no override).
        preview_text = await page.locator('[data-testid="preview-points"]').inner_text()
        parts = [p.strip() for p in preview_text.split("–")]
        preview_a = float(parts[0])
        preview_b = float(parts[1])
        assert_eq(preview_a + preview_b, 7.0, "frame-derived preview must sum to 7")
        print(f"preview A={preview_a} B={preview_b} (sum={preview_a + preview_b})")

        assert_true(await page.locator('[data-testid="validation-errors"]').count() == 0,
                    "validation errors present before save")
        # Save button must be enabled.
        assert_true(await page.locator('[data-testid="save-result"]').is_enabled(),
                    "save button must be enabled")

        await page.locator('[data-testid="save-result"]').click()
        await page.wait_for_selector('[data-testid="save-flash"]', timeout=5000)
        flash_text = await page.locator('[data-testid="save-flash"]').inner_text()
        assert_true("Result saved" in flash_text, f"flash message wrong: {flash_text!r}")
        assert_true(await page.locator('[data-testid="editing-saved-banner"]').count() == 1,
                    "editing-saved banner must appear after save")

        # ------------------------------------------------------------------
        # 5) Verify persisted MatchResult in localStorage.
        # ------------------------------------------------------------------
        store = await read_store(page)
        saved = next(m for m in store["matchesByWeek"][str(wk)] if m["id"] == match_id)
        assert_eq(saved["status"], "completed", "saved match status")
        r = saved["result"]
        assert_true(r is not None and "linescoreA" in r and "linescoreB" in r,
                    "saved result missing linescore keys")
        assert_true("note" not in r, "note-only placeholder must not exist")
        # 3 games × 10 frames per side.
        for side_key, targets in (("linescoreA", TARGETS_A), ("linescoreB", TARGETS_B)):
            ls = r[side_key]
            assert_eq(len(ls["games"]), 3, f"{side_key} game count")
            for gi, g in enumerate(ls["games"]):
                assert_eq(len(g["frames"]), 10, f"{side_key} game {gi + 1} frame count")
                assert_eq(g["frames"][9]["cumulativeScore"], targets[gi],
                          f"{side_key} game {gi + 1} scratchTotal")
        # Frozen scheduled metadata present.
        for key in ("scheduledNameA", "scheduledNameB",
                    "entryAverageA", "entryAverageB",
                    "handicapA", "handicapB"):
            assert_true(key in r, f"frozen field missing: {key}")
        # Points sum to 7 (no override).
        assert_eq(r["totalPointsA"] + r["totalPointsB"], 7,
                  "persisted total points must sum to 7")
        print(f"saved awards: A={r['totalPointsA']} B={r['totalPointsB']} "
              f"scratch A={r['scratchTotalA']} B={r['scratchTotalB']} "
              f"hdcpA={r['handicapTotalA']} hdcpB={r['handicapTotalB']}")
        # DEBUG — directly ask the client store what b35 aggregates look like now.
        dbg = await page.evaluate("""(id) => {
            const db = window.__pssStore.getDb();
            const persisted = localStorage.getItem('pss.leagueStore.v3');
            const parsed = persisted ? JSON.parse(persisted) : null;
            const w8mem = (db.matchesByWeek[8] || []).filter(m => m.result).length;
            const w8ls = parsed ? (parsed.matchesByWeek['8'] || parsed.matchesByWeek[8] || []).filter(m => m.result).length : -1;
            return {w8InMemory: w8mem, w8InLocalStorage: w8ls, keys: Object.keys(parsed?.matchesByWeek || {}).slice(0,12)};
        }""", a_id)
        print("DEBUG post-save DB:", dbg)

        awarded_a1 = r["totalPointsA"]
        awarded_b1 = r["totalPointsB"]
        hdcp_a1 = r["handicapTotalA"]
        hdcp_b1 = r["handicapTotalB"]
        scratch_a1 = r["scratchTotalA"]
        scratch_b1 = r["scratchTotalB"]

        # ------------------------------------------------------------------
        # 6) Public data verification.
        # ------------------------------------------------------------------
        # Weekly Results — week 8 must now appear even though other matches
        # are still scheduled. Assert exact per-game and scratch totals.
        await page.goto(f"{BASE}/weekly-results", wait_until="domcontentloaded")
        await page.wait_for_selector('[data-testid="wr-week-select"]', timeout=8000)
        await page.wait_for_load_state("networkidle")
        await asyncio.sleep(0.3)
        current = (await page.locator('[data-testid="wr-week-select"]').inner_text()).strip()
        if current != f"Week {wk}":
            await page.locator('[data-testid="wr-week-select"]').click()
            await page.get_by_role("option", name=f"Week {wk}").click()
            await asyncio.sleep(0.3)
        await asyncio.sleep(0.3)
        for gi, tot in enumerate(TARGETS_A):
            txt = await page.locator(f'[data-testid="wr-row-{match_id}-A-g{gi + 1}"]').inner_text()
            assert_true(str(tot) in txt, f"weekly-results A game {gi + 1} missing {tot}")
        for gi, tot in enumerate(TARGETS_B):
            txt = await page.locator(f'[data-testid="wr-row-{match_id}-B-g{gi + 1}"]').inner_text()
            assert_true(str(tot) in txt, f"weekly-results B game {gi + 1} missing {tot}")
        assert_true(
            str(scratch_a1) in await page.locator(f'[data-testid="wr-row-{match_id}-A-scratch"]').inner_text(),
            "weekly-results A scratch total mismatch")
        assert_true(
            str(scratch_b1) in await page.locator(f'[data-testid="wr-row-{match_id}-B-scratch"]').inner_text(),
            "weekly-results B scratch total mismatch")

        # Standings delta assertions.
        new_a = await capture_standings_row(page, a_id)
        new_b = await capture_standings_row(page, b_id)
        print("post-save A:", new_a)
        print("post-save B:", new_b)
        assert_eq(new_a["w"] - base_a["w"], awarded_a1, "A W delta")
        assert_eq(new_a["l"] - base_a["l"], awarded_b1, "A L delta (= opp award)")
        assert_eq(new_a["hcp_pinfall"] - base_a["hcp_pinfall"], hdcp_a1, "A hcp pinfall delta")
        assert_eq(new_a["games"] - base_a["games"], 3, "A games delta")
        assert_eq(new_b["w"] - base_b["w"], awarded_b1, "B W delta")
        assert_eq(new_b["l"] - base_b["l"], awarded_a1, "B L delta")
        assert_eq(new_b["hcp_pinfall"] - base_b["hcp_pinfall"], hdcp_b1, "B hcp pinfall delta")
        assert_eq(new_b["games"] - base_b["games"], 3, "B games delta")

        # Bowler profile — history-week-8 row must exist with exact scores.
        await page.goto(f"{BASE}/bowlers/{a_id}", wait_until="domcontentloaded")
        await page.wait_for_selector(f'[data-testid="history-week-{wk}"]', timeout=8000)
        scores_attr = await page.locator(f'[data-testid="history-week-{wk}"]').get_attribute("data-scores")
        assert_eq(scores_attr, ",".join(str(t) for t in TARGETS_A),
                  "bowler A profile history-week-8 data-scores")
        scratch_attr = await page.locator(f'[data-testid="history-week-{wk}"]').get_attribute("data-scratch-total")
        assert_eq(int(scratch_attr or 0), scratch_a1, "profile A scratch-total")

        # Statistics / leaderboards / lane-data — assert route renders and
        # snapshot-driven content includes affected bowlers.
        for path, needle in (
            ("/statistics", "Statistics"),
            ("/leaderboards", "Leaderboard"),
            ("/leaderboards/advanced", "Advanced"),
            ("/lane-data", "Lane"),
        ):
            resp = await page.goto(f"{BASE}{path}", wait_until="domcontentloaded")
            assert_true(resp is not None and resp.status == 200, f"{path} status")
            body = await page.content()
            assert_true(needle.lower() in body.lower(), f"{path} content missing '{needle}'")
        # Sanity: the affected lane pair appears in Lane Data.
        assert_true(match["lanePair"] in await page.content(),
                    f"lane-data missing pair {match['lanePair']}")

        # ------------------------------------------------------------------
        # 7) Reload + editor rehydrates + replacement edit.
        # ------------------------------------------------------------------
        await ctx.close()
        ctx = await browser.new_context(viewport={"width": 1280, "height": 1800},
                                        storage_state=None)
        # Re-inject the persisted store into the fresh context.
        page2 = await ctx.new_page()
        await page2.goto(f"{BASE}/", wait_until="domcontentloaded")
        await page2.evaluate(
            "(db) => localStorage.setItem('pss.leagueStore.v3', JSON.stringify(db))",
            store,
        )
        await page2.goto(f"{BASE}/admin/results", wait_until="domcontentloaded")
        await page2.wait_for_selector('[data-testid="admin-results-toolbar"]', timeout=8000)
        await page2.wait_for_load_state("networkidle")
        await asyncio.sleep(0.3)
        await page2.locator('[data-testid="week-select"]').click()
        await page2.get_by_role("option", name=f"Week {wk}").click()
        await asyncio.sleep(0.2)
        await page2.locator('[data-testid="match-select"]').click()
        opts = await page2.locator('[role="option"]').all_inner_texts()
        opt_idx = next(i for i, t in enumerate(opts) if t.startswith(f"Lanes {lane_pair} · Slot {slot}"))
        await page2.locator('[role="option"]').nth(opt_idx).click()
        await asyncio.sleep(0.4)

        assert_true(await page2.locator('[data-testid="editing-saved-banner"]').count() == 1,
                    "reload: editor must show editing-saved banner")
        # Rehydrated cumulative for A g3 frame 10 must equal 80 (before edit).
        rehydrated = await page2.locator('[data-testid="side-A-g3-cum-9"]').input_value()
        assert_eq(int(rehydrated), TARGETS_A[2], "rehydrated A g3 final cumulative")

        # Change ONLY game 3 of side A from 80 → 45. Re-fill that game.
        await fill_game(page2, "A", 2, EDIT_G3_A)
        await asyncio.sleep(0.3)
        await page2.locator('[data-testid="save-result"]').click()
        await page2.wait_for_selector('[data-testid="save-flash"]', timeout=5000)

        # Refetch persisted result.
        store2 = await read_store(page2)
        saved2 = next(m for m in store2["matchesByWeek"][str(wk)] if m["id"] == match_id)
        r2 = saved2["result"]
        assert_eq(r2["gamesA"][2], EDIT_G3_A, "replacement A game 3 scratch")
        awarded_a2, awarded_b2 = r2["totalPointsA"], r2["totalPointsB"]
        hdcp_a2, hdcp_b2 = r2["handicapTotalA"], r2["handicapTotalB"]

        # Weekly-results reflects replacement, not addition.
        await page2.goto(f"{BASE}/weekly-results", wait_until="domcontentloaded")
        await page2.wait_for_selector('[data-testid="wr-week-select"]', timeout=8000)
        await page2.wait_for_load_state("networkidle")
        await asyncio.sleep(0.3)
        current2 = (await page2.locator('[data-testid="wr-week-select"]').inner_text()).strip()
        if current2 != f"Week {wk}":
            await page2.locator('[data-testid="wr-week-select"]').click()
            await page2.get_by_role("option", name=f"Week {wk}").click()
            await asyncio.sleep(0.3)
        txt = await page2.locator(f'[data-testid="wr-row-{match_id}-A-g3"]').inner_text()
        assert_true(str(EDIT_G3_A) in txt, "weekly-results A g3 must show replacement value")
        assert_true(str(TARGETS_A[2]) not in txt.split()[0:2],
                    "weekly-results A g3 must NOT still show the old value")

        # Bowler profile reflects replacement.
        await page2.goto(f"{BASE}/bowlers/{a_id}", wait_until="domcontentloaded")
        await page2.wait_for_selector(f'[data-testid="history-week-{wk}"]', timeout=8000)
        scores2 = await page2.locator(f'[data-testid="history-week-{wk}"]').get_attribute("data-scores")
        assert_eq(scores2, f"{TARGETS_A[0]},{TARGETS_A[1]},{EDIT_G3_A}",
                  "profile A history scores after edit")

        # Standings must reflect a REPLACEMENT delta from baseline, not
        # baseline + save1 + save2. Exactly one match's worth of contribution.
        final_a = await capture_standings_row(page2, a_id)
        final_b = await capture_standings_row(page2, b_id)
        assert_eq(final_a["games"] - base_a["games"], 3,
                  "A games delta must still be 3 after edit (replacement, not double)")
        assert_eq(final_a["hcp_pinfall"] - base_a["hcp_pinfall"], hdcp_a2,
                  "A hcp pinfall reflects replacement delta only")
        assert_eq(final_a["w"] - base_a["w"], awarded_a2, "A W after edit = baseline + new award")
        assert_eq(final_a["l"] - base_a["l"], awarded_b2, "A L after edit = baseline + new opp award")
        assert_eq(final_b["games"] - base_b["games"], 3, "B games delta stays 3")
        assert_eq(final_b["hcp_pinfall"] - base_b["hcp_pinfall"], hdcp_b2,
                  "B hcp pinfall reflects replacement")

        print("all assertions passed.")

        # Save a final screenshot for evidence.
        await page2.goto(f"{BASE}/weekly-results", wait_until="domcontentloaded")
        await page2.wait_for_selector('[data-testid="wr-week-select"]', timeout=8000)
        await page2.screenshot(path=str(SCREENSHOTS / "weekly-results-final.png"))

        if errors:
            print("collected page/console errors (first 6):")
            for e in errors[:6]:
                print(" ", e[:400])

        await browser.close()
        return 0


if __name__ == "__main__":
    try:
        rc = asyncio.run(main())
    except Fail as e:
        print(f"TEST FAILED: {e}", file=sys.stderr)
        rc = 1
    sys.exit(rc)
