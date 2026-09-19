import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../fingerprint.js";
import type { Json } from "../world.js";

describe("computeFingerprint", () => {
  it("is pure: the same data twice produces the same fingerprint twice", () => {
    const data: Json = { reserved: 3, tags: ["a", "b"] };
    expect(computeFingerprint(data)).toBe(computeFingerprint(data));
    expect(computeFingerprint(structuredClone(data))).toBe(computeFingerprint(data));
  });

  it("is independent of object key insertion order", () => {
    const a: Json = { x: 1, y: 2, z: { p: true, q: false } };
    const b: Json = { z: { q: false, p: true }, y: 2, x: 1 };
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });

  it("differs for logically different data", () => {
    expect(computeFingerprint({ reserved: 3 })).not.toBe(computeFingerprint({ reserved: 4 }));
  });

  it("does NOT depend on array element order — arrays are not sorted (order is meaningful data, unlike object keys)", () => {
    expect(computeFingerprint([1, 2, 3])).not.toBe(computeFingerprint([3, 2, 1]));
  });

  it("produces a stable, deterministic hex string shape", () => {
    const fp = computeFingerprint({ a: 1 });
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
  });
});
