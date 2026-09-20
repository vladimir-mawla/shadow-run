import { describe, expect, it } from "vitest";
import { deepFreezeClone, type Json } from "../../contracts/index.js";
import { deleteAtPath, getAtPath, PathResolutionError, setAtPath } from "../path.js";

describe("getAtPath", () => {
  it("reads a top-level key", () => {
    expect(getAtPath({ a: 1 }, "a")).toBe(1);
  });

  it("reads a nested key via a dot-path", () => {
    expect(getAtPath({ a: { b: { c: 3 } } }, "a.b.c")).toBe(3);
  });

  it("returns undefined for a missing leaf", () => {
    expect(getAtPath({ a: 1 }, "b")).toBeUndefined();
  });

  it("returns undefined when an intermediate segment is missing, rather than throwing", () => {
    expect(getAtPath({ a: 1 }, "a.b.c")).toBeUndefined();
  });

  it("returns undefined when an intermediate segment exists but is not an object (e.g. a number)", () => {
    expect(getAtPath({ a: 1 }, "a.b")).toBeUndefined();
  });
});

describe("setAtPath", () => {
  it("replaces an existing top-level value", () => {
    expect(setAtPath({ a: 1 }, "a", 2)).toEqual({ a: 2 });
  });

  it("creates a missing leaf (the append case)", () => {
    expect(setAtPath({}, "a", 1)).toEqual({ a: 1 });
  });

  it("creates missing intermediate objects along the way", () => {
    expect(setAtPath({}, "a.b.c", 1)).toEqual({ a: { b: { c: 1 } } });
  });

  it("does NOT mutate the input tree", () => {
    const input: Json = deepFreezeClone({ a: { b: 1 }, c: 2 });
    const result = setAtPath(input, "a.b", 99);
    expect(result).toEqual({ a: { b: 99 }, c: 2 });
    expect(input).toEqual({ a: { b: 1 }, c: 2 }); // input untouched
  });

  it("structurally shares untouched siblings rather than deep-cloning the whole tree", () => {
    const untouchedSibling = { keep: "me" };
    const input = { a: { b: 1 }, sibling: untouchedSibling };
    const result = setAtPath(input, "a.b", 2) as { sibling: unknown };
    expect(result.sibling).toBe(untouchedSibling); // same reference, not a copy
  });

  it("throws PathResolutionError when a segment expects an object but finds an array", () => {
    expect(() => setAtPath({ a: [1, 2, 3] }, "a.b", 1)).toThrow(PathResolutionError);
  });

  it("works against a deep-frozen input without throwing (it never assigns into the input)", () => {
    const input = deepFreezeClone({ a: { b: 1 } });
    expect(() => setAtPath(input, "a.b", 2)).not.toThrow();
  });
});

describe("deleteAtPath", () => {
  it("removes a top-level key entirely (not set to undefined — the key itself is gone)", () => {
    const result = deleteAtPath({ a: 1, b: 2 }, "a") as Record<string, unknown>;
    expect(Object.hasOwn(result, "a")).toBe(false);
    expect(result).toEqual({ b: 2 });
  });

  it("removes a nested key", () => {
    expect(deleteAtPath({ a: { b: 1, c: 2 } }, "a.b")).toEqual({ a: { c: 2 } });
  });

  it("is a no-op (returns data unchanged) when the path does not exist", () => {
    const input = { a: 1 };
    expect(deleteAtPath(input, "b")).toEqual(input);
  });

  it("is a no-op when an intermediate segment is missing", () => {
    const input = { a: 1 };
    expect(deleteAtPath(input, "x.y")).toEqual(input);
  });

  it("does NOT mutate the input tree", () => {
    const input: Json = deepFreezeClone({ a: { b: 1, c: 2 } });
    deleteAtPath(input, "a.b");
    expect(input).toEqual({ a: { b: 1, c: 2 } }); // input untouched
  });
});
