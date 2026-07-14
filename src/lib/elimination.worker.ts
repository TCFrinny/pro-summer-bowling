/**
 * Module Web Worker: runs the schedule-aware `computeElimination()` in the
 * ADMIN'S browser off the main thread. Never runs on Cloudflare Workers.
 *
 * Input: EliminationInput (activeBowlers, weeks, matchesByWeek, totalWeeks).
 * Output: `{ ok: true, snapshot: EliminationSnapshot }` on success, or
 *         `{ ok: false, error: string }` on any thrown error.
 */

/// <reference lib="webworker" />

import { computeElimination, type EliminationInput } from "./elimination";

interface RunMessage { kind: "run"; input: EliminationInput; }
type OutMessage =
  | { kind: "result"; snapshot: ReturnType<typeof computeElimination> }
  | { kind: "error"; error: string };

// eslint-disable-next-line no-restricted-globals
const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.addEventListener("message", (evt: MessageEvent<RunMessage>) => {
  try {
    const snapshot = computeElimination(evt.data.input);
    const out: OutMessage = { kind: "result", snapshot };
    ctx.postMessage(out);
  } catch (err) {
    const out: OutMessage = {
      kind: "error",
      error: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(out);
  }
});
