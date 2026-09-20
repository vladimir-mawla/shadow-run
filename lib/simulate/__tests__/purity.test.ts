import { describe, expect, it } from "vitest";
import { simulate } from "../simulate.js";
import { deterministicReserveAdapter, impureRandomAdapter, makeReserveAction, makeStockWorld } from "./fixtures.js";

/**
 * M3 success criterion (a) — `sim-plan.md` §C: "`simulate()` is pure —
 * called twice with identical input, deep-equal output." See
 * `simulate.ts`'s own header for the honest scoping of this claim: this
 * function's OWN body contributes no non-determinism, but it cannot force
 * an adapter's `project()` to be pure either. Both halves are proven
 * below, deliberately as two separate tests rather than one — conflating
 * them would let a reader believe "purity" is one single guarantee this
 * milestone owns end to end, which is exactly the overclaim the build
 * brief warns against ("do not claim a guarantee you only partly have").
 */
describe("simulate() purity", () => {
  it("POSITIVE CASE: given a deterministic adapter, calling simulate() twice with identical input produces deep-equal output", () => {
    const world = makeStockWorld(39);
    const action = makeReserveAction(3);

    const first = simulate(action, world, deterministicReserveAdapter);
    const second = simulate(action, world, deterministicReserveAdapter);

    expect(first).toEqual(second);
    expect(first.ok).toBe(true);
  });

  it("POSITIVE CASE, three calls: not just two — the same identical output holds across a longer repeat sequence, ruling out an off-by-one 'it happened to match once' result", () => {
    const world = makeStockWorld(10);
    const action = makeReserveAction(1);

    const results = [
      simulate(action, world, deterministicReserveAdapter),
      simulate(action, world, deterministicReserveAdapter),
      simulate(action, world, deterministicReserveAdapter),
    ];

    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
  });

  it("HONEST GAP, DEMONSTRATED NOT HIDDEN: a deliberately impure adapter (Math.random() inside project()) breaks purity across repeat calls — proving simulate() neither adds nor conceals that non-determinism, rather than claiming it prevents it", () => {
    const world = makeStockWorld(0);
    const action = makeReserveAction(0);

    const first = simulate(action, world, impureRandomAdapter);
    const second = simulate(action, world, impureRandomAdapter);

    // Both calls succeed (the impure adapter is still well-shaped and
    // self-consistent FOR EACH INDIVIDUAL CALL — Math.random() is read
    // once and then everything derived from it is internally honest).
    // What breaks is agreement BETWEEN calls, which is exactly the
    // property "purity" means and exactly what simulate() cannot fix.
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(first).not.toEqual(second);
  });

  it("the input World object itself is unaffected by repeat calls (no shared mutable state leaking between them)", () => {
    const world = makeStockWorld(5);
    const action = makeReserveAction(2);
    const worldSnapshotBefore = JSON.parse(JSON.stringify(world));

    simulate(action, world, deterministicReserveAdapter);
    simulate(action, world, deterministicReserveAdapter);

    expect(JSON.parse(JSON.stringify(world))).toEqual(worldSnapshotBefore);
  });
});
