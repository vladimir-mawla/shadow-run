import { describe, expect, it } from "vitest";
import type { Delta, Reconciliation } from "../../lib/contracts/index";
import { describeReconciledDelta, formatDeltaValue, hasNoNetChange } from "../delta-render-rules";

describe("hasNoNetChange", () => {
  it("is false for a genuinely-observed drift (real INV-2-shaped numbers)", () => {
    // m6-domain-cases.md INV-2: predicted stock.reserved 42, really observed 45.
    const actual: Delta = { path: "stock.reserved", before: 40, after: 45, kind: "increment" };
    expect(hasNoNetChange(actual)).toBe(false);
  });

  it("is true for a Decision-4-shaped synthesized no-op (reconcile()'s 'vanished prediction' case)", () => {
    // ADR 0003 Decision 4: reconcile() constructs { path, before: predicted.before,
    // after: predicted.before, kind: "set" } when nothing was observed to change.
    const synthesized: Delta = { path: "stock.available", before: 108, after: 108, kind: "set" };
    expect(hasNoNetChange(synthesized)).toBe(true);
  });

  it("is true for a genuinely-observed no-op of the identical shape — proving the two are indistinguishable", () => {
    // Same shape as the synthesized case above, on purpose: the ADR's own point is that
    // reconcile() gives this function no way to tell "constructed" from "really observed
    // and nothing moved" apart. This test asserts the boolean, not a provenance claim.
    const genuinelyObservedNoOp: Delta = { path: "stock.available", before: 108, after: 108, kind: "set" };
    expect(hasNoNetChange(genuinelyObservedNoOp)).toBe(true);
  });

  it("compares before/after deep-equal, not by reference — a fresh object with identical fields is still no-op", () => {
    const delta: Delta = {
      path: "reservation.res-9001",
      before: { orderId: "ord-1", qty: 37 },
      after: { orderId: "ord-1", qty: 37 },
      kind: "set",
    };
    expect(hasNoNetChange(delta)).toBe(true);
  });
});

describe("formatDeltaValue", () => {
  it("renders numbers, strings, booleans, and null/undefined plainly", () => {
    expect(formatDeltaValue(42)).toBe("42");
    expect(formatDeltaValue("res-9042")).toBe("res-9042");
    expect(formatDeltaValue(true)).toBe("true");
    expect(formatDeltaValue(null)).toBe("null");
    expect(formatDeltaValue(undefined)).toBe("undefined");
  });

  it("renders a plain object via JSON.stringify", () => {
    expect(formatDeltaValue({ orderId: "ord-5534", qty: 3 })).toBe('{"orderId":"ord-5534","qty":3}');
  });
});

describe("describeReconciledDelta — the one shared rendering rule, applied unconditionally", () => {
  it("renders the ADR's exact verbatim phrase for a synthesized-shaped actual — never 'observed: X'", () => {
    const actual: Delta = { path: "stock.available", before: 108, after: 108, kind: "set" };
    expect(describeReconciledDelta(actual, "actual")).toBe("no change was observed at this path");
    // The forbidden alternative, spelled out so a future edit that reintroduces it fails loudly:
    expect(describeReconciledDelta(actual, "actual")).not.toContain("observed: 108");
  });

  it("renders the mirrored phrase for a no-net-change predicted side", () => {
    const expected: Delta = { path: "stock.available", before: 108, after: 108, kind: "set" };
    expect(describeReconciledDelta(expected, "predicted")).toBe("no change was predicted at this path");
  });

  it("renders 'actual: <value>' for a real, non-trivial drift", () => {
    const actual: Delta = { path: "stock.reserved", before: 40, after: 45, kind: "increment" };
    expect(describeReconciledDelta(actual, "actual")).toBe("actual: 45");
  });

  it("renders 'predicted: <value>' for the matching expected side of the same drift", () => {
    const expected: Delta = { path: "stock.reserved", before: 37, after: 42, kind: "increment" };
    expect(describeReconciledDelta(expected, "predicted")).toBe("predicted: 42");
  });

  it("applies the identical rule whether the Delta comes from a drifted or an unprojected Reconciliation", () => {
    // Constructed from the frozen Reconciliation union (lib/contracts/reconciliation.ts),
    // not hand-picked Delta literals divorced from the type reconcile() actually returns.
    const drifted: Reconciliation = {
      status: "drifted",
      expected: { path: "stock.reserved", before: 37, after: 42, kind: "increment" },
      actual: { path: "stock.reserved", before: 40, after: 45, kind: "increment" },
    };
    const unprojected: Reconciliation = {
      status: "unprojected",
      actual: { path: "reservations", before: [], after: [{ id: "res-9099" }], kind: "append" },
    };

    if (drifted.status !== "drifted") throw new Error("test fixture must be drifted");
    expect(describeReconciledDelta(drifted.actual, "actual")).toBe("actual: 45");
    expect(describeReconciledDelta(drifted.expected, "predicted")).toBe("predicted: 42");

    if (unprojected.status !== "unprojected") throw new Error("test fixture must be unprojected");
    expect(describeReconciledDelta(unprojected.actual, "actual")).toBe('actual: [{"id":"res-9099"}]');
  });

  it("applies the same unconditional check to a confirmed Reconciliation's matched deltas", () => {
    const confirmed: Reconciliation = {
      status: "confirmed",
      matched: [{ path: "stock.reserved", before: 37, after: 42, kind: "increment" }],
    };
    if (confirmed.status !== "confirmed") throw new Error("test fixture must be confirmed");
    const [matched] = confirmed.matched;
    if (matched === undefined) throw new Error("test fixture must have one matched delta");
    expect(describeReconciledDelta(matched, "actual")).toBe("actual: 42");
  });
});
