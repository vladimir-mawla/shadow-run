import { describe, expect, it } from "vitest";
import { computeFingerprint, type World } from "../../contracts/index.js";
import type { SimulationAdapter } from "../adapter.js";
import { checkConsistency } from "../consistency.js";
import { simulate } from "../simulate.js";
import { deterministicReserveAdapter, makeReserveAction, makeStockWorld, validEffectFor39, type StockState } from "./fixtures.js";

/**
 * The four fail-closed gates `simulate.ts` runs, exercised end to end
 * through `simulate()` itself (not just unit-testing `checkConsistency`/
 * `validateEffectShape` in isolation) — this is the direct proof for the
 * build brief's own question: "what happens when an adapter throws,
 * returns a malformed `ProjectedEffect`, or returns deltas that
 * contradict its own `resultingFingerprint`?"
 */
describe("checkConsistency — the self-consistency check in isolation", () => {
  it("a truthful effect is consistent", () => {
    const result = checkConsistency({ reserved: 39 }, validEffectFor39());
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("LAYER 1: catches a delta lying about its own `before` value", () => {
    const dishonest = { ...validEffectFor39(), deltas: [{ path: "reserved", before: 999, after: 42, kind: "increment" as const }] };
    const result = checkConsistency({ reserved: 39 }, dishonest);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("started at 999") && p.includes("actually has 39"))).toBe(true);
  });

  it("LAYER 1: catches an 'append' that claims a fresh leaf where one already exists", () => {
    const dishonestAppend = {
      ...validEffectFor39(),
      deltas: [{ path: "reserved", before: undefined, after: 1, kind: "append" as const }],
    };
    const result = checkConsistency({ reserved: 39 }, dishonestAppend);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes('claims "append"') && p.includes("already exists"))).toBe(true);
  });

  it("LAYER 2: catches a resultingFingerprint that doesn't match what the deltas actually produce", () => {
    const wrongHash = { ...validEffectFor39(), resultingFingerprint: "00000000" };
    const result = checkConsistency({ reserved: 39 }, wrongHash);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.includes("resultingFingerprint mismatch"))).toBe(true);
  });

  it("a correct multi-delta sequence (remove then re-append at a nested path) is still verified as consistent", () => {
    const data = { a: { b: 1 }, c: 2 };
    const afterRemove = { a: {}, c: 2 };
    const afterAppend = { a: { b: 99 }, c: 2 };
    const effect = {
      deltas: [
        { path: "a.b", before: 1, after: undefined, kind: "remove" as const },
        { path: "a.b", before: undefined, after: 99, kind: "append" as const },
      ],
      resultingFingerprint: computeFingerprint(afterAppend),
      assumptions: [],
      producedBy: "shadow-execution" as const,
    };
    void afterRemove;
    const result = checkConsistency(data, effect);
    expect(result.ok).toBe(true);
  });
});

describe("simulate() end to end: the four fail-closed gates", () => {
  it("GATE 1 (invalid-world): an input World whose fingerprint doesn't match its own data is rejected before the adapter is ever called", () => {
    let adapterWasCalled = false;
    const spyAdapter: SimulationAdapter<StockState> = {
      project(action, world) {
        adapterWasCalled = true;
        return deterministicReserveAdapter.project(action, world);
      },
    };
    const corruptWorld: World<StockState> = {
      id: "sku-42",
      domain: "inventory",
      version: 1,
      at: "2026-09-20T00:00:00.000Z",
      data: { reserved: 39 },
      fingerprint: "not-the-real-hash",
    };

    const result = simulate(makeReserveAction(3), corruptWorld, spyAdapter);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe("invalid-world");
    expect(adapterWasCalled).toBe(false);
  });

  it("GATE 2 (adapter-threw): an adapter that throws an ordinary error (not a mutation attempt) is caught and named", () => {
    const throwingAdapter: SimulationAdapter<StockState> = {
      project() {
        throw new RangeError("amount out of range");
      },
    };

    const result = simulate(makeReserveAction(3), makeStockWorld(39), throwingAdapter);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("adapter-threw");
      if (result.failure.kind === "adapter-threw") {
        expect(result.failure.error).toBe("RangeError: amount out of range");
      }
    }
  });

  it("GATE 3 (malformed-effect): an adapter returning a value missing required fields is rejected and named", () => {
    const malformedAdapter = {
      project: () => ({ deltas: [], producedBy: "shadow-execution" }), // missing resultingFingerprint and assumptions
    } as unknown as SimulationAdapter<StockState>;

    const result = simulate(makeReserveAction(3), makeStockWorld(39), malformedAdapter);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("malformed-effect");
      if (result.failure.kind === "malformed-effect") {
        expect(result.failure.problems.some((p) => p.includes("resultingFingerprint"))).toBe(true);
        expect(result.failure.problems.some((p) => p.includes("assumptions"))).toBe(true);
      }
    }
  });

  it("GATE 3 (malformed-effect): a free-text assumption smuggled past the type system at runtime is caught", () => {
    const smugglingAdapter = {
      project: () => ({
        deltas: [{ path: "reserved", before: 39, after: 42, kind: "increment" }],
        resultingFingerprint: computeFingerprint({ reserved: 42 }),
        assumptions: ["assume the customer doesn't cancel"], // exactly the "model's prose" shape projected-effect.ts's type exists to reject at compile time; this proves the RUNTIME gate also rejects it when the type system is bypassed.
        producedBy: "shadow-execution",
      }),
    } as unknown as SimulationAdapter<StockState>;

    const result = simulate(makeReserveAction(3), makeStockWorld(39), smugglingAdapter);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("malformed-effect");
      if (result.failure.kind === "malformed-effect") {
        expect(result.failure.problems.some((p) => p.includes("closed AssumptionKind enum"))).toBe(true);
      }
    }
  });

  it("GATE 3 (malformed-effect), MEDIUM-3 regression: an 'increment' delta whose after is non-numeric is rejected — delta.ts defines increment as a signed numeric change, and this was previously never checked", () => {
    const nonsenseIncrementAdapter = {
      project: () => ({
        deltas: [{ path: "reserved", before: 39, after: "banana", kind: "increment" }],
        resultingFingerprint: computeFingerprint({ reserved: 42 }),
        assumptions: [],
        producedBy: "shadow-execution",
      }),
    } as unknown as SimulationAdapter<StockState>;

    const result = simulate(makeReserveAction(3), makeStockWorld(39), nonsenseIncrementAdapter);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("malformed-effect");
      if (result.failure.kind === "malformed-effect") {
        expect(result.failure.problems.some((p) => p.includes('kind "increment"') && p.includes("not a finite number"))).toBe(true);
      }
    }
  });

  it("GATE 3 sanity: an 'increment' that is a legitimate DECREASE (after < before) is NOT rejected — kind's numeric coherence check must not over-constrain the sign", () => {
    const decrementAdapter: SimulationAdapter<StockState> = {
      project: () => ({
        deltas: [{ path: "reserved", before: 39, after: 10, kind: "increment" }],
        resultingFingerprint: computeFingerprint({ reserved: 10 }),
        assumptions: [],
        producedBy: "shadow-execution",
      }),
    };

    const result = simulate(makeReserveAction(-29), makeStockWorld(39), decrementAdapter);

    expect(result.ok).toBe(true);
  });

  it("GATE 4 (inconsistent-effect): an adapter whose claimed resultingFingerprint doesn't match its own claimed deltas is rejected", () => {
    const lyingAdapter: SimulationAdapter<StockState> = {
      project: () => ({
        deltas: [{ path: "reserved", before: 39, after: 42, kind: "increment" }],
        resultingFingerprint: "00000000", // does not match computeFingerprint({ reserved: 42 })
        assumptions: [],
        producedBy: "shadow-execution",
      }),
    };

    const result = simulate(makeReserveAction(3), makeStockWorld(39), lyingAdapter);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("inconsistent-effect");
      if (result.failure.kind === "inconsistent-effect") {
        expect(result.failure.problems.some((p) => p.includes("resultingFingerprint mismatch"))).toBe(true);
      }
    }
  });

  it("GATE 4 (inconsistent-effect): an adapter whose delta lies about the world's starting value is rejected even though its final hash is 'consistent' with ITS OWN lie", () => {
    const lyingAboutStartAdapter: SimulationAdapter<StockState> = {
      project: () => {
        // Internally self-consistent (before/after/hash all agree with
        // EACH OTHER) but "before: 39" is false — the real World started
        // at a different value. This is precisely the case Layer 1 exists
        // to catch and Layer 2 alone would miss.
        const fabricatedBefore = 39;
        const after = 100;
        return {
          deltas: [{ path: "reserved", before: fabricatedBefore, after, kind: "increment" }],
          resultingFingerprint: computeFingerprint({ reserved: after }),
          assumptions: [],
          producedBy: "shadow-execution",
        };
      },
    };

    // Real world actually started at 7, not 39.
    const result = simulate(makeReserveAction(3), makeStockWorld(7), lyingAboutStartAdapter);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe("inconsistent-effect");
      if (result.failure.kind === "inconsistent-effect") {
        expect(result.failure.problems.some((p) => p.includes("started at 39") && p.includes("actually has 7"))).toBe(true);
      }
    }
  });

  it("the happy path: a truthful adapter produces ok:true with the real effect attached", () => {
    const result = simulate(makeReserveAction(3), makeStockWorld(39), deterministicReserveAdapter);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effect.deltas).toEqual([{ path: "reserved", before: 39, after: 42, kind: "increment" }]);
      expect(result.effect.resultingFingerprint).toBe(computeFingerprint({ reserved: 42 }));
    }
  });
});
