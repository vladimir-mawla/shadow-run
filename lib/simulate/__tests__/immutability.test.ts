import { describe, expect, it } from "vitest";
import { computeFingerprint, type World } from "../../contracts/index.js";
import type { Action } from "../action.js";
import type { SimulationAdapter } from "../adapter.js";
import { simulate } from "../simulate.js";
import { deterministicReserveAdapter, makeReserveAction, makeStockWorld, type StockState } from "./fixtures.js";

/**
 * M3 success criterion (b) — `sim-plan.md` §C: "[simulate()] never
 * mutates the input `World` (deep-freeze the input, assert a mutation
 * attempt throws rather than silently succeeding)." Three separate claims
 * are proven below, deliberately kept apart because they are different
 * guarantees layered on top of each other (see `simulate.ts`'s header):
 *
 *   1. The `World` an adapter actually receives is frozen — a direct
 *      mutation attempt against it throws, not silently no-ops.
 *   2. This holds even when the CALLER's own `World` was hand-built and
 *      never frozen in the first place (skipping `makeWorld` entirely) —
 *      proving `simulate()` defends this structurally, rather than
 *      merely inheriting frozenness from `makeWorld` and hoping every
 *      caller used it.
 *   3. An adapter that actually ATTEMPTS a mutation (not just an
 *      after-the-fact check by the test) is caught by `simulate()`'s own
 *      try/catch and reported as a named `adapter-threw` failure, never
 *      silently swallowed as a successful `ProjectedEffect`.
 */
describe("simulate() never lets an adapter mutate the World it was given", () => {
  it("CLAIM 1: the World object the adapter receives has frozen data — mutating it directly throws", () => {
    let capturedWorld: World<StockState> | undefined;
    const capturingAdapter: SimulationAdapter<StockState> = {
      project(_action, world) {
        capturedWorld = world;
        return deterministicReserveAdapter.project(_action, world);
      },
    };

    const world = makeStockWorld(39);
    const result = simulate(makeReserveAction(3), world, capturingAdapter);

    expect(result.ok).toBe(true);
    expect(capturedWorld).toBeDefined();
    expect(() => {
      // @ts-expect-error — StockState's `reserved` is readonly; this line proves the RUNTIME guarantee (Object.freeze throws in strict mode), the type error is incidental to reaching it.
      capturedWorld!.data.reserved = 999;
    }).toThrow(TypeError);
  });

  it("CLAIM 2: freezing happens even for a hand-built World that skipped makeWorld and was never frozen by the caller", () => {
    // Built by hand, exactly like lib/contracts/__tests__/ does on purpose
    // to exercise guards in isolation (world.ts's own doc comment) —
    // world.data below is an ordinary, MUTABLE object literal, ­deliberately
    // not run through makeWorld/deepFreezeClone before this test starts.
    const mutableData: StockState = { reserved: 10 };
    const handBuiltWorld: World<StockState> = {
      id: "sku-hand-built",
      domain: "inventory",
      version: 1,
      at: "2026-09-20T00:00:00.000Z",
      data: mutableData,
      fingerprint: computeFingerprint(mutableData),
    };
    expect(Object.isFrozen(handBuiltWorld.data)).toBe(false); // confirms the premise: the caller's own World really is mutable.

    let capturedWorld: World<StockState> | undefined;
    const capturingAdapter: SimulationAdapter<StockState> = {
      project(action, world) {
        capturedWorld = world;
        return deterministicReserveAdapter.project(action, world);
      },
    };

    const result = simulate(makeReserveAction(1), handBuiltWorld, capturingAdapter);
    expect(result.ok).toBe(true);
    expect(Object.isFrozen(capturedWorld!.data)).toBe(true); // simulate() froze it before the adapter ever saw it.
    expect(() => {
      (capturedWorld!.data as { reserved: number }).reserved = 999;
    }).toThrow(TypeError);

    // And the CALLER's own object is untouched — simulate() cloned rather
    // than freezing the caller's object in place (world.ts's own
    // "clones rather than freezing in place" rule, reused here).
    expect(Object.isFrozen(mutableData)).toBe(false);
    expect(mutableData.reserved).toBe(10);
  });

  it("CLAIM 3: an adapter that actually attempts a mutation is caught, not silently swallowed as success", () => {
    const mutatingAdapter: SimulationAdapter<StockState> = {
      project(_action: Action, world: World<StockState>) {
        (world.data as { reserved: number }).reserved = 12345; // real attempt, not a test-side probe.
        // Unreachable in practice — the line above throws first — but
        // typed so this file compiles as a well-formed SimulationAdapter.
        return deterministicReserveAdapter.project(_action, world);
      },
    };

    const result = simulate(makeReserveAction(1), makeStockWorld(39), mutatingAdapter);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("adapter-threw");
      if (result.failure.kind === "adapter-threw") {
        expect(result.failure.error).toMatch(/TypeError/);
      }
    }
  });

  it("the caller's original World is deep-equal before and after a successful simulate() call", () => {
    const world = makeStockWorld(7);
    const before = JSON.parse(JSON.stringify(world));

    simulate(makeReserveAction(2), world, deterministicReserveAdapter);

    expect(JSON.parse(JSON.stringify(world))).toEqual(before);
  });
});
