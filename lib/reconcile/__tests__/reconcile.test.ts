import { describe, expect, it } from "vitest";
import type { Delta } from "../../contracts/delta.js";
import { MalformedDeltaArrayError, reconcile } from "../reconcile.js";

/**
 * M4 success criteria (plan §C, M4 / `.genesis/PLAN.md`), each proven
 * against the REAL `reconcile()`, not a restatement of `reconcile.ts`'s
 * own doc comments:
 *   1. Identical predicted/observed deltas reconcile to `confirmed`.
 *   2. A single mismatched field reconciles to `drifted`, naming the
 *      exact expected/actual `Delta`.
 *   3. An observed delta absent from the projection reconciles to
 *      `unprojected`.
 * Plus the design questions this milestone was asked to answer and prove,
 * not just assert in prose: path-based matching, order-independence,
 * `kind` as part of equality, the "vanished prediction" fourth case, the
 * multi-drift priority rule, and the fail-closed malformed-input case.
 */

const RESERVE_42: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
const RESERVE_45: Delta = { path: "stock.reserved", before: 39, after: 45, kind: "increment" };
const NOTE_ADDED: Delta = { path: "outbox.queue", before: [], after: ["hi"], kind: "append" };

describe("reconcile(): confirmed", () => {
  it("identical predicted/observed deltas reconcile to confirmed, carrying the matched deltas", () => {
    const result = reconcile([RESERVE_42], [RESERVE_42]);
    expect(result).toEqual({ status: "confirmed", matched: [RESERVE_42] });
  });

  it("two empty arrays reconcile to confirmed with nothing matched -- reconcile() is total, this is not a degenerate/error case", () => {
    expect(reconcile([], [])).toEqual({ status: "confirmed", matched: [] });
  });

  it("multiple agreeing deltas across different paths all confirm together", () => {
    const result = reconcile([RESERVE_42, NOTE_ADDED], [RESERVE_42, NOTE_ADDED]);
    expect(result.status).toBe("confirmed");
    if (result.status === "confirmed") {
      expect(result.matched).toEqual([RESERVE_42, NOTE_ADDED]);
    }
  });

  it("DESIGN DECISION: matching is by `path`, not array position -- identical content in a different order still confirms", () => {
    const result = reconcile([RESERVE_42, NOTE_ADDED], [NOTE_ADDED, RESERVE_42]);
    expect(result.status).toBe("confirmed");
  });

  it("a deep-equal but non-identical `before`/`after` object still confirms (structural equality, not reference equality)", () => {
    const predicted: Delta = { path: "cal.event", before: { time: "09:00" }, after: { time: "10:00" }, kind: "set" };
    const observed: Delta = { path: "cal.event", before: { time: "09:00" }, after: { time: "10:00" }, kind: "set" };
    expect(reconcile([predicted], [observed])).toEqual({ status: "confirmed", matched: [predicted] });
  });
});

describe("reconcile(): drifted", () => {
  it("a single mismatched field (same path, different `after`) reconciles to drifted, naming the exact expected/actual Delta", () => {
    const result = reconcile([RESERVE_42], [RESERVE_45]);
    expect(result).toEqual({ status: "drifted", expected: RESERVE_42, actual: RESERVE_45 });
  });

  it("DESIGN DECISION: a `kind` mismatch is drift even when the resulting value is identical -- see reconcile.ts's dedicated comment for why", () => {
    const predictedAsSet: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "set" };
    const observedAsIncrement: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
    const result = reconcile([predictedAsSet], [observedAsIncrement]);
    expect(result).toEqual({ status: "drifted", expected: predictedAsSet, actual: observedAsIncrement });
  });

  it("a mismatched `before` alone (not just `after`) is also drift", () => {
    const predicted: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
    const observed: Delta = { path: "stock.reserved", before: 40, after: 42, kind: "increment" };
    const result = reconcile([predicted], [observed]);
    expect(result).toEqual({ status: "drifted", expected: predicted, actual: observed });
  });

  it("DESIGN DECISION: a 'vanished' prediction (predicted a change, nothing at that path actually changed) is drifted, with a synthesized no-op actual", () => {
    const result = reconcile([RESERVE_42], []);
    expect(result).toEqual({
      status: "drifted",
      expected: RESERVE_42,
      actual: { path: "stock.reserved", before: 39, after: 39, kind: "set" },
    });
  });

  it("DESIGN DECISION: when both a drift and an unprojected delta exist, drift is reported (priority rule), even if the unprojected path sorts earlier", () => {
    // "cal.event" < "stock.reserved" lexicographically, so an unprojected
    // delta at "cal.event" would win a pure path-sort race -- it must not:
    // drift-class mismatches are checked in their own pass, first.
    const unprojectedFirst: Delta = { path: "cal.event", before: "09:00", after: "10:00", kind: "set" };
    const result = reconcile([RESERVE_42], [RESERVE_45, unprojectedFirst]);
    expect(result).toEqual({ status: "drifted", expected: RESERVE_42, actual: RESERVE_45 });
  });

  it("DESIGN DECISION: when multiple paths drift, the lexicographically-first path's drift is reported, deterministically", () => {
    const predictedA: Delta = { path: "a.field", before: 1, after: 2, kind: "set" };
    const predictedZ: Delta = { path: "z.field", before: 1, after: 2, kind: "set" };
    const observedA: Delta = { path: "a.field", before: 1, after: 99, kind: "set" };
    const observedZ: Delta = { path: "z.field", before: 1, after: 99, kind: "set" };
    // Feed them in reverse order to prove the result is sorted by path, not call-site array order.
    const result = reconcile([predictedZ, predictedA], [observedZ, observedA]);
    expect(result).toEqual({ status: "drifted", expected: predictedA, actual: observedA });
  });
});

describe("reconcile(): unprojected", () => {
  it("an observed delta absent from the projection reconciles to unprojected", () => {
    const result = reconcile([], [NOTE_ADDED]);
    expect(result).toEqual({ status: "unprojected", actual: NOTE_ADDED });
  });

  it("an unprojected delta alongside otherwise-fully-confirmed predictions still surfaces as unprojected", () => {
    const result = reconcile([RESERVE_42], [RESERVE_42, NOTE_ADDED]);
    expect(result).toEqual({ status: "unprojected", actual: NOTE_ADDED });
  });

  it("the lexicographically-first unprojected path is reported when several exist and nothing drifted", () => {
    const zPath: Delta = { path: "z.field", before: 1, after: 2, kind: "set" };
    const aPath: Delta = { path: "a.field", before: 1, after: 2, kind: "set" };
    const result = reconcile([], [zPath, aPath]);
    expect(result).toEqual({ status: "unprojected", actual: aPath });
  });
});

describe("reconcile(): fail-closed on malformed input", () => {
  it("throws MalformedDeltaArrayError when the PREDICTED side has two Deltas for the same path, rather than picking one", () => {
    const first: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
    const second: Delta = { path: "stock.reserved", before: 39, after: 43, kind: "increment" };
    expect(() => reconcile([first, second], [])).toThrow(MalformedDeltaArrayError);
    expect(() => reconcile([first, second], [])).toThrow(/predicted/);
  });

  it("throws MalformedDeltaArrayError when the OBSERVED side has two Deltas for the same path", () => {
    const first: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
    const second: Delta = { path: "stock.reserved", before: 39, after: 43, kind: "increment" };
    expect(() => reconcile([], [first, second])).toThrow(MalformedDeltaArrayError);
    expect(() => reconcile([], [first, second])).toThrow(/observed/);
  });

  it("is otherwise total: every well-formed (at most one Delta per path, per side) input pair reaches a return, never an unhandled branch", () => {
    // A deliberately varied mixed case -- some confirmed, would-be drift
    // avoided here so this test asserts totality, not a specific status.
    const result = reconcile([RESERVE_42, NOTE_ADDED], [RESERVE_42]);
    expect(["confirmed", "drifted", "unprojected"]).toContain(result.status);
  });
});
