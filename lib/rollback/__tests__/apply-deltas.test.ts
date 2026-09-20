import { describe, expect, it } from "vitest";
import type { Delta } from "../../contracts/delta.js";
import { makeWorld } from "../../contracts/index.js";
import { applyDeltas, RollbackStepFailedError } from "../apply-deltas.js";
import { invertDelta } from "../invert-delta.js";

// A `type` alias, deliberately NOT an `interface` — an object-literal-shaped
// `interface` is NOT assignable to `Json`'s index signature even when every
// field it declares is individually Json-compatible (TypeScript requires an
// explicit `[key: string]: Json` on an `interface` to satisfy that check; a
// `type` alias built from an object type literal does not need one). Verified
// directly against this repo's own `tsc` before writing this file, the same
// "confirmed, not assumed" discipline ADR 0001 already applied to its own
// `TState` deviation — an `interface Fixture` here would fail `makeWorld`'s
// `TState extends Json` constraint with "Index signature ... is missing",
// which is a fact about `interface` vs `type`, not about this data being
// non-plain (`isPlainData` at runtime does not care either way).
type Fixture = {
  readonly stock: { readonly reserved: number; readonly available: number };
  readonly flags: { readonly beta?: boolean };
  readonly outbox: readonly string[];
  readonly note: string | null;
};

function fixtureWorld(data: Fixture) {
  return makeWorld<Fixture>({ id: "sku-42", domain: "inventory", version: 1, at: "2026-09-20T00:00:00.000Z", data });
}

/**
 * M5 success criterion 1, THE ROUND TRIP, proved directly through
 * `applyDeltas` for each of the four `Delta.kind` values: apply a delta,
 * apply its inverse, and assert the resulting `World.data` deep-equals
 * the ORIGINAL `World.data` — not merely "looks similar," `toEqual`
 * against the exact original object.
 */
describe("applyDeltas + invertDelta round trip — all four Delta.kind values", () => {
  it("set", () => {
    const before = fixtureWorld({ stock: { reserved: 3, available: 10 }, flags: {}, outbox: [], note: null });
    const delta: Delta = { path: "note", before: null, after: "hold for VIP", kind: "set" };
    const after = applyDeltas(before, [delta]);
    expect(after.data.note).toBe("hold for VIP");
    const restored = applyDeltas(after, [invertDelta(delta)]);
    expect(restored.data).toEqual(before.data);
    expect(restored.fingerprint).toBe(before.fingerprint);
  });

  it("increment", () => {
    const before = fixtureWorld({ stock: { reserved: 39, available: 10 }, flags: {}, outbox: [], note: null });
    const delta: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
    const after = applyDeltas(before, [delta]);
    expect(after.data.stock.reserved).toBe(42);
    const restored = applyDeltas(after, [invertDelta(delta)]);
    expect(restored.data).toEqual(before.data);
    expect(restored.fingerprint).toBe(before.fingerprint);
  });

  it("remove", () => {
    const before = fixtureWorld({ stock: { reserved: 0, available: 10 }, flags: { beta: true }, outbox: [], note: null });
    const delta: Delta = { path: "flags.beta", before: true, after: undefined, kind: "remove" };
    const after = applyDeltas(before, [delta]);
    expect(Object.prototype.hasOwnProperty.call(after.data.flags, "beta")).toBe(false);
    const restored = applyDeltas(after, [invertDelta(delta)]);
    expect(restored.data).toEqual(before.data);
    expect(restored.fingerprint).toBe(before.fingerprint);
  });

  it("append", () => {
    const before = fixtureWorld({ stock: { reserved: 0, available: 10 }, flags: {}, outbox: [], note: null });
    const delta: Delta = { path: "outbox", before: [], after: ["welcome-email"], kind: "append" };
    const after = applyDeltas(before, [delta]);
    expect(after.data.outbox).toEqual(["welcome-email"]);
    const restored = applyDeltas(after, [invertDelta(delta)]);
    expect(restored.data).toEqual(before.data);
    expect(restored.fingerprint).toBe(before.fingerprint);
  });
});

describe("applyDeltas: per-step verification (the 'before' check)", () => {
  it("throws RollbackStepFailedError, naming the exact step, when the current value does not match the recorded 'before'", () => {
    const world = fixtureWorld({ stock: { reserved: 39, available: 10 }, flags: {}, outbox: [], note: null });
    const wrongDelta: Delta = { path: "stock.reserved", before: 999, after: 42, kind: "increment" };
    try {
      applyDeltas(world, [wrongDelta]);
      throw new Error("expected applyDeltas to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(RollbackStepFailedError);
      const e = error as RollbackStepFailedError;
      expect(e.stepIndex).toBe(0);
      expect(e.delta).toEqual(wrongDelta);
      expect(e.foundAtPath).toBe(39);
    }
  });

  it("ATOMICITY: when step 2 of 3 fails, the ORIGINAL World argument is provably untouched — no half-restored result is ever returned", () => {
    const world = fixtureWorld({ stock: { reserved: 39, available: 10 }, flags: {}, outbox: [], note: null });
    const originalFingerprint = world.fingerprint;
    const originalDataSnapshot = structuredClone(world.data);

    const steps: Delta[] = [
      { path: "stock.reserved", before: 39, after: 40, kind: "increment" }, // step 0: would succeed alone
      { path: "stock.available", before: 12345, after: 9, kind: "set" }, // step 1: WRONG before — fails here
      { path: "note", before: null, after: "unreachable", kind: "set" }, // step 2: never gets here
    ];

    expect(() => applyDeltas(world, steps)).toThrow(RollbackStepFailedError);

    // The single most dangerous state this milestone's brief names — a
    // half-restored World silently treated as valid — is checked directly:
    // the ORIGINAL `world` object must still be exactly what it was.
    expect(world.fingerprint).toBe(originalFingerprint);
    expect(world.data).toEqual(originalDataSnapshot);
    expect(world.data.stock.reserved).toBe(39); // NOT 40 — step 0's effect never became visible on `world`.

    try {
      applyDeltas(world, steps);
    } catch (error) {
      const e = error as RollbackStepFailedError;
      expect(e.stepIndex).toBe(1); // names exactly which step failed
      expect(e.delta.path).toBe("stock.available");
    }
  });

  it("does not mutate the input World even on a fully successful run (returns a new World; makeWorld deep-freezes it)", () => {
    const world = fixtureWorld({ stock: { reserved: 1, available: 10 }, flags: {}, outbox: [], note: null });
    const delta: Delta = { path: "stock.reserved", before: 1, after: 2, kind: "increment" };
    const result = applyDeltas(world, [delta]);
    expect(world.data.stock.reserved).toBe(1); // input untouched
    expect(result.data.stock.reserved).toBe(2); // a new World, returned
    expect(() => {
      // @ts-expect-error — result.data is deep-frozen (via makeWorld); assigning is a type error too, but the runtime throw is the actual guarantee under test.
      result.data.stock.reserved = 999;
    }).toThrow();
  });
});

describe("applyDeltas: kind is never inspected at application time (path.ts's uniform rule)", () => {
  it("applies a 'remove' and an 'append' with the identical verify-then-write rule used for 'set'/'increment'", () => {
    const world = fixtureWorld({ stock: { reserved: 0, available: 10 }, flags: {}, outbox: ["a"], note: null });
    const appendDelta: Delta = { path: "outbox", before: ["a"], after: ["a", "b"], kind: "append" };
    const afterAppend = applyDeltas(world, [appendDelta]);
    expect(afterAppend.data.outbox).toEqual(["a", "b"]);

    const removeDelta: Delta = { path: "outbox", before: ["a", "b"], after: ["a"], kind: "remove" };
    const afterRemove = applyDeltas(afterAppend, [removeDelta]);
    expect(afterRemove.data.outbox).toEqual(["a"]);
  });
});
