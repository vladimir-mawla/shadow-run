import { describe, expect, it } from "vitest";
import type { Delta } from "../delta.js";

describe("Delta", () => {
  it("accepts all four kinds", () => {
    const deltas: readonly Delta[] = [
      { path: "a", before: 1, after: 2, kind: "set" },
      { path: "b", before: 1, after: 2, kind: "increment" },
      { path: "c", before: 1, after: undefined, kind: "remove" },
      { path: "d", before: undefined, after: 1, kind: "append" },
    ];
    expect(deltas).toHaveLength(4);
  });

  it("TYPE-LEVEL: kind is a closed union — a fifth kind does not compile", () => {
    // @ts-expect-error — "replace" is not one of the four real Delta kinds.
    const bad: Delta = { path: "a", before: 1, after: 2, kind: "replace" };
    expect(bad).toBeDefined();
  });

  it("TYPE-LEVEL: path must be a string", () => {
    // @ts-expect-error — path is a dot-path string, not a structured accessor.
    const bad: Delta = { path: ["a", "b"], before: 1, after: 2, kind: "set" };
    expect(bad).toBeDefined();
  });
});
