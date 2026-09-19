import { describe, expect, it } from "vitest";
import { assertPlainData, isPlainData, makeWorld, NonPlainDataError, type Json, type World } from "../world.js";
import { computeFingerprint } from "../fingerprint.js";

/**
 * M1 success criterion (plan §C, M1): "`World.data` must be plain,
 * serializable data — no functions. Enforce this in the type system as far
 * as TypeScript allows, and test it." This file proves both halves: the
 * type-level constraint (a `@ts-expect-error` that a function-shaped
 * `data` fails to satisfy `Json`) and the runtime gate (`isPlainData`/
 * `assertPlainData`) that catches a deliberate cast around the type system
 * — see world.ts's header for why both are needed, not just one.
 */
describe("World.data is plain, serializable data", () => {
  it("accepts a plain, JSON-shaped data value", () => {
    const world: World<{ readonly reserved: number; readonly note: string | null }> = {
      id: "sku-42",
      domain: "inventory",
      version: 1,
      at: "2026-09-20T00:00:00.000Z",
      data: { reserved: 3, note: null },
      fingerprint: computeFingerprint({ reserved: 3, note: null }),
    };
    expect(world.data.reserved).toBe(3);
  });

  it("TYPE-LEVEL: a World whose data type includes a function does not compile", () => {
    // @ts-expect-error — `TState` must extend `Json`; a function-typed field makes this data shape unassignable to Json, so it cannot be used as World's type parameter.
    const bad: World<{ readonly onCancel: () => void }> = {
      id: "x",
      domain: "d",
      version: 1,
      at: "2026-09-20T00:00:00.000Z",
      data: { onCancel: () => {} },
      fingerprint: "deadbeef",
    };
    expect(bad).toBeDefined();
  });

  it("RUNTIME: isPlainData rejects a function value even when a deliberate cast defeats the type check", () => {
    // Mirrors decision-engine's own brand-cast gap (`__tests__/brand-casts.test.ts`):
    // a type constraint cannot stop an explicit `as` assertion. This proves the
    // runtime gate catches what the type system, by design, cannot.
    const smuggled = { onCancel: () => {} } as unknown as Json;
    expect(isPlainData(smuggled)).toBe(false);
  });

  it("RUNTIME: isPlainData rejects Date, Map, and Set — not just bare functions", () => {
    expect(isPlainData(new Date() as unknown as Json)).toBe(false);
    expect(isPlainData(new Map() as unknown as Json)).toBe(false);
    expect(isPlainData(new Set() as unknown as Json)).toBe(false);
  });

  it("RUNTIME: isPlainData rejects a symbol-keyed property", () => {
    const withSymbol: Record<string | symbol, unknown> = { a: 1, [Symbol("s")]: 2 };
    expect(isPlainData(withSymbol as unknown as Json)).toBe(false);
  });

  it("RUNTIME: isPlainData rejects a circular reference", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular["self"] = circular;
    expect(isPlainData(circular as unknown as Json)).toBe(false);
  });

  it("RUNTIME: isPlainData accepts nested plain arrays and objects", () => {
    const nested: Json = { a: [1, 2, { b: "c", d: null }], e: true };
    expect(isPlainData(nested)).toBe(true);
  });

  it("assertPlainData throws NonPlainDataError, named so a caller can distinguish it from any other failure", () => {
    const smuggled = { run: () => 1 } as unknown as Json;
    expect(() => assertPlainData(smuggled, "World.data")).toThrow(NonPlainDataError);
    expect(() => assertPlainData(smuggled, "World.data")).toThrow(/World\.data/);
  });

  it("assertPlainData is silent for real plain data", () => {
    expect(() => assertPlainData({ a: 1, b: [true, null, "x"] }, "World.data")).not.toThrow();
  });

  it("sanity: JSON round-trip actually works for accepted data (the point of requiring Json in the first place)", () => {
    const data: Json = { reserved: 3, tags: ["a", "b"], meta: { ok: true, note: null } };
    const roundTripped = JSON.parse(JSON.stringify(data));
    expect(roundTripped).toEqual(data);
  });
});

describe("makeWorld — the one blessed World constructor", () => {
  it("constructs a valid World and computes fingerprint from data itself", () => {
    const world = makeWorld({
      id: "sku-42",
      domain: "inventory",
      version: 1,
      at: "2026-09-20T00:00:00.000Z",
      data: { reserved: 3, note: null as string | null },
    });
    expect(world.fingerprint).toBe(computeFingerprint({ reserved: 3, note: null }));
    expect(world.id).toBe("sku-42");
    expect(world.data.reserved).toBe(3);
  });

  it("TYPE-LEVEL: makeWorld's input has no fingerprint field — a caller cannot supply a stale or wrong one", () => {
    const world = makeWorld({
      id: "x",
      domain: "d",
      version: 1,
      at: "2026-09-20T00:00:00.000Z",
      data: { a: 1 },
      // @ts-expect-error — fingerprint is not part of makeWorld's input; it is always computed, never accepted from a caller.
      fingerprint: "deadbeef",
    });
    expect(world).toBeDefined();
  });

  it("TYPE-LEVEL + RUNTIME: data with a function does not compile, and the runtime guard also rejects it — the same Json constraint World<TState> itself enforces, doubly", () => {
    expect(() => {
      // @ts-expect-error — TState is inferred from `data` and must extend Json; a function-typed field is not assignable to Json, so `makeWorld`'s own type parameter cannot be inferred here.
      makeWorld({ id: "x", domain: "d", version: 1, at: "2026-09-20T00:00:00.000Z", data: { onCancel: () => {} } });
    }).toThrow(NonPlainDataError);
  });

  it("RUNTIME: makeWorld throws NonPlainDataError for data that defeats the type system via a cast — the guard is load-bearing here, not merely exported", () => {
    const smuggled = { onCancel: () => {} } as unknown as Json;
    expect(() =>
      makeWorld({ id: "x", domain: "d", version: 1, at: "2026-09-20T00:00:00.000Z", data: smuggled }),
    ).toThrow(NonPlainDataError);
  });
});
