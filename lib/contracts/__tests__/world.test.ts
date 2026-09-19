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

  /**
   * L4 verification finding: TypeScript types an object-literal getter by
   * its RETURN type, so a getter satisfies `Json` with NO cast at all —
   * wider than the "deliberate `x as Json` cast" gap the file header
   * originally named. A value whose reads are not guaranteed to agree
   * breaks this project's "same input, same fingerprint, always" premise
   * even though it is not a function. See world.ts's file header, point 2.
   */
  it("RUNTIME: isPlainData rejects an object with an accessor property (a getter) — no cast needed to defeat the type system", () => {
    let n = 0;
    const obj = {
      get x() {
        n++;
        return n;
      },
    };
    const asJson: Json = obj; // compiles with zero type errors — no `as` anywhere.
    expect(isPlainData(asJson)).toBe(false);
    expect(n).toBe(0); // rejected via the property descriptor, never by actually invoking the getter.
  });

  it("RUNTIME: isPlainData rejects a getter nested inside an otherwise-plain object", () => {
    const nested: Json = { a: 1, b: { get c(): number { return 2; } } as unknown as Json };
    expect(isPlainData(nested)).toBe(false);
  });

  it("RUNTIME: isPlainData rejects an accessor property at an array index", () => {
    const arr: unknown[] = [1, 2, 3];
    Object.defineProperty(arr, 1, { get: () => 99, enumerable: true, configurable: true });
    expect(isPlainData(arr as unknown as Json)).toBe(false);
  });

  /**
   * KNOWN LIMITATION, documented rather than fixed (see world.ts's file
   * header, "KNOWN, UNCLOSED GAP"). A `Proxy` controls the answer to every
   * reflection call `isPlainData` makes (`ownKeys`,
   * `getOwnPropertyDescriptor`, `getPrototypeOf`, `get`), so it can present
   * a fabricated, entirely-innocent view of itself while a real
   * function-valued property remains reachable by name. This is not a bug
   * in `isPlainData` to fix — it is a real, stated boundary of what a
   * reflection-based runtime walk can ever prove. Do not weaken this test
   * or its comment: the walk is fooled here, on purpose, to prove the gap
   * is real rather than hypothetical.
   */
  it("KNOWN LIMITATION: a Proxy can hide a function-valued property from isPlainData's reflection-based walk entirely", () => {
    const target = { a: 1, run: () => "still runs" };
    const proxy = new Proxy(target, {
      ownKeys() {
        return ["a"]; // hides "run" from every reflection API isPlainData calls.
      },
      getOwnPropertyDescriptor(t, prop) {
        if (prop === "a") return { value: t.a, enumerable: true, configurable: true, writable: true };
        return undefined; // legal: "run" is configurable on `target`, so a trap may report it absent.
      },
    });

    // isPlainData is fooled: it only ever sees key "a", an ordinary number.
    expect(isPlainData(proxy as unknown as Json)).toBe(true);
    // Yet the function is really there, reachable by anyone who accesses it directly.
    expect(typeof (proxy as unknown as { run: () => string }).run).toBe("function");
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

  it("RUNTIME: makeWorld throws NonPlainDataError for a getter-bearing value, with no cast at all", () => {
    const withGetter = { get x() { return 1; } };
    const asJson: Json = withGetter;
    expect(() =>
      makeWorld({ id: "x", domain: "d", version: 1, at: "2026-09-20T00:00:00.000Z", data: asJson }),
    ).toThrow(NonPlainDataError);
  });
});
