import { computeFingerprint, makeWorld, type ProjectedEffect, type World } from "../../contracts/index.js";
import type { Action } from "../action.js";
import type { SimulationAdapter } from "../adapter.js";

/**
 * Shared test fixtures for `lib/simulate/__tests__/**`. NOT a real domain
 * deliverable — M6 (`domains/**`) owns the real calendar/inventory/
 * notification/infra-resize adapters (`sim-plan.md` §D). This file exists
 * only so this milestone's own tests have something realistic-shaped to
 * run `simulate()` against without reaching three milestones ahead of
 * where the repo actually is.
 */

// A TYPE ALIAS to an object literal, deliberately not an `interface` —
// TypeScript only grants a named object shape the "implicit index
// signature" compatibility `Json`'s `{ readonly [key: string]: Json }`
// branch relies on when it is a fresh object-literal TYPE (or a literal
// expression, as lib/contracts/__tests__/world.test.ts uses inline); a
// same-shaped `interface` declaration does NOT get that compatibility and
// fails to satisfy `Json` even though it describes an identical shape —
// confirmed directly against this repo's own `tsc` while writing this
// fixture, not assumed.
export type StockState = {
  readonly reserved: number;
};

/** Builds a `World<StockState>` the way a real caller would — through `makeWorld`, so `fingerprint` is honest from the start. */
export function makeStockWorld(reserved: number, overrides: Partial<{ id: string; version: number }> = {}): World<StockState> {
  return makeWorld({
    id: overrides.id ?? "sku-42",
    domain: "inventory",
    version: overrides.version ?? 1,
    at: "2026-09-20T00:00:00.000Z",
    data: { reserved },
  });
}

export function makeReserveAction(amount: number): Action {
  return { domain: "inventory", type: "reserve", params: { amount } };
}

/**
 * A genuinely deterministic, hand-mirrored `project()` — Approach C from
 * `sim-plan.md` §A.2, in miniature: reads `world.data.reserved`, computes
 * the same increment the real executor would apply, and returns a typed
 * diff. No clock, no randomness, no I/O of any kind.
 */
export const deterministicReserveAdapter: SimulationAdapter<StockState> = {
  project(action, world) {
    const amount = (action.params as { readonly amount: number }).amount;
    const before = world.data.reserved;
    const after = before + amount;
    const nextData: StockState = { reserved: after };
    return {
      deltas: [{ path: "reserved", before, after, kind: "increment" }],
      resultingFingerprint: computeFingerprint(nextData),
      assumptions: ["no-concurrent-writer", "world-version-unchanged"],
      producedBy: "shadow-execution",
    };
  },
};

/** Deliberately impure — calls `Math.random()` — used ONLY to demonstrate honestly, in `purity.test.ts`, that `simulate()` detects but cannot structurally prevent an adapter's own non-determinism (see `simulate.ts`'s header). Never used outside that one demonstration. */
export const impureRandomAdapter: SimulationAdapter<StockState> = {
  project(_action, world) {
    const noise = Math.floor(Math.random() * 1000);
    const nextData: StockState = { reserved: world.data.reserved + noise };
    return {
      deltas: [{ path: "reserved", before: world.data.reserved, after: nextData.reserved, kind: "increment" }],
      resultingFingerprint: computeFingerprint(nextData),
      assumptions: [],
      producedBy: "shadow-execution",
    };
  },
};

/** A well-formed-looking `ProjectedEffect` for the fixture `StockState` world above (`reserved: 39`), used across `consistency.test.ts`/`effect-validation` cases as the one known-good baseline every mutated/broken variant is derived from. */
export function validEffectFor39(): ProjectedEffect {
  return {
    deltas: [{ path: "reserved", before: 39, after: 42, kind: "increment" }],
    resultingFingerprint: computeFingerprint({ reserved: 42 }),
    assumptions: ["no-concurrent-writer"],
    producedBy: "shadow-execution",
  };
}
