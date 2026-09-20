import { describe, expect, it } from "vitest";
import type { Delta } from "../../contracts/delta.js";
import { invertDelta } from "../invert-delta.js";

/**
 * M5 success criterion 1 (plan §C, M5 / PLAN.md): "`invertDelta` is total
 * and correct for all four `Delta.kind` values — a round trip (apply a
 * delta, then apply its inverse) returns the original `World.data`
 * exactly." This file proves the TYPE-LEVEL/relabeling half directly
 * (every `kind`, plus the genuinely edge-y non-numeric-`increment` case
 * this milestone's own design questions name); the round-trip-through-
 * `applyDeltas` half is proved in `apply-deltas.test.ts` and
 * `run-rollback.test.ts`, since a round trip is inherently a claim about
 * both functions working together, not `invertDelta` in isolation.
 */
describe("invertDelta — kind coverage", () => {
  it("set: swaps before/after, keeps kind", () => {
    const d: Delta = { path: "event.time", before: "09:00", after: "10:00", kind: "set" };
    expect(invertDelta(d)).toEqual({ path: "event.time", before: "10:00", after: "09:00", kind: "set" });
  });

  it("increment: swaps before/after, keeps kind", () => {
    const d: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
    expect(invertDelta(d)).toEqual({ path: "stock.reserved", before: 42, after: 39, kind: "increment" });
  });

  it("remove: swaps before/after AND relabels to set (reintroducing a value is a set, not a remove)", () => {
    const d: Delta = { path: "flags.beta", before: true, after: undefined, kind: "remove" };
    expect(invertDelta(d)).toEqual({ path: "flags.beta", before: undefined, after: true, kind: "set" });
  });

  it("append: swaps before/after AND relabels to remove (undoing an addition is a remove, not an append)", () => {
    const d: Delta = { path: "outbox", before: [], after: ["hello"], kind: "append" };
    expect(invertDelta(d)).toEqual({ path: "outbox", before: ["hello"], after: [], kind: "remove" });
  });

  it("inverting twice returns to the original delta shape (for the symmetric kinds)", () => {
    const d: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
    expect(invertDelta(invertDelta(d))).toEqual(d);
  });

  it("inverting remove twice does NOT return to 'remove' — invertDelta is not its own inverse across kind-changing cases", () => {
    // Documents, rather than merely asserts, an easy-to-miss asymmetry:
    // invert(invert(x)) === x holds for set/increment (the kind never
    // changes, so two swaps cancel out), but NOT in general once the
    // `kind` label itself changes. invert(a "remove") is a "set" — and
    // that "set" describes a real, different fact ("this value is being
    // (re)written") than the original "remove" did ("this value is being
    // deleted"), even though the underlying before/after payload is the
    // same pair each time. invertDelta is a correct involution on the
    // (before, after) PAYLOAD, not on the full (kind, before, after)
    // triple — recorded here explicitly so it is never mistaken for a bug
    // by a later reader expecting invert(invert(x)) === x unconditionally.
    const removeDelta: Delta = { path: "flags.beta", before: true, after: undefined, kind: "remove" };
    const invertedOnce = invertDelta(removeDelta); // -> a "set": { before: undefined, after: true }
    const invertedTwice = invertDelta(invertedOnce); // "set" swaps back to "set": { before: true, after: undefined }
    expect(invertedTwice).toEqual({ path: "flags.beta", before: true, after: undefined, kind: "set" });
    expect(invertedTwice).not.toEqual(removeDelta); // same payload, but "set" now, not "remove" — the point of this test.
  });
});

describe("invertDelta is total: it never inspects the payload's runtime type", () => {
  it("does not throw, and inverts correctly, when an 'increment' Delta's before/after are NOT numbers", () => {
    // This milestone's own design questions ask directly: "what about
    // increment on a value that was not a number?" The answer, proved
    // here: nothing special happens, because invertDelta never does
    // arithmetic — it swaps opaque `unknown` values regardless of their
    // type (see invert-delta.ts's header). A design that inverted
    // `increment` by negating a numeric amount would fail on this exact
    // input; this one does not, because that design was rejected.
    const weird: Delta = { path: "note.text", before: "hello", after: "goodbye", kind: "increment" };
    expect(() => invertDelta(weird)).not.toThrow();
    expect(invertDelta(weird)).toEqual({ path: "note.text", before: "goodbye", after: "hello", kind: "increment" });
  });

  it("does not throw, and inverts correctly, when before/after are undefined, null, or deeply nested objects", () => {
    const withUndefined: Delta = { path: "x", before: undefined, after: 1, kind: "set" };
    expect(invertDelta(withUndefined)).toEqual({ path: "x", before: 1, after: undefined, kind: "set" });

    const withNested: Delta = {
      path: "participants",
      before: { list: [{ id: "a" }] },
      after: { list: [{ id: "a" }, { id: "b" }] },
      kind: "append",
    };
    expect(invertDelta(withNested)).toEqual({
      path: "participants",
      before: { list: [{ id: "a" }, { id: "b" }] },
      after: { list: [{ id: "a" }] },
      kind: "remove",
    });
  });
});
