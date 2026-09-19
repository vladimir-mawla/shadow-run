import { describe, expect, it } from "vitest";
import { assertNeverReconciliation, type Reconciliation } from "../reconciliation.js";
import type { Delta } from "../delta.js";

const SAMPLE_DELTA: Delta = { path: "stock.reserved", before: 39, after: 42, kind: "increment" };
const SAMPLE_DELTA_2: Delta = { path: "stock.reserved", before: 39, after: 45, kind: "increment" };

/**
 * M1 success criterion (plan §C, M1): "`Reconciliation`'s three statuses
 * [are] exhaustively matched via an `assertNeverReconciliation` helper,
 * with a test that a fourth status would fail to compile until handled
 * everywhere." This mirrors decision-engine's own
 * `match-exhaustiveness.test.ts` pattern (`lib/decide/__tests__/`): the
 * thing being proven IS a compile error, so the proof runs via
 * `npm run typecheck` (which includes this file, `tsc -p
 * tsconfig.lib.json`), not via a runtime assertion that could not observe
 * a compile failure even in principle.
 */

function describeReconciliation(reconciliation: Reconciliation): string {
  switch (reconciliation.status) {
    case "confirmed":
      return `confirmed: ${reconciliation.matched.length} deltas matched`;
    case "drifted":
      return `drifted: ${reconciliation.expected.path} expected ${String(reconciliation.expected.after)}, got ${String(reconciliation.actual.after)}`;
    case "unprojected":
      return `unprojected: ${reconciliation.actual.path} changed with no projection`;
    default:
      // If a fourth Reconciliation variant is ever added, `reconciliation`
      // here is no longer narrowed to `never` by the switch above, and this
      // call stops compiling — see the type-level proof below for the
      // literal simulation of that.
      return assertNeverReconciliation(reconciliation);
  }
}

describe("Reconciliation's three statuses", () => {
  it("confirmed carries the matched deltas, not a bare boolean", () => {
    const r: Reconciliation = { status: "confirmed", matched: [SAMPLE_DELTA] };
    expect(describeReconciliation(r)).toContain("1 deltas matched");
  });

  it("drifted names the exact expected and actual Delta", () => {
    const r: Reconciliation = { status: "drifted", expected: SAMPLE_DELTA, actual: SAMPLE_DELTA_2 };
    expect(describeReconciliation(r)).toBe("drifted: stock.reserved expected 42, got 45");
  });

  it("unprojected names the one actual Delta nobody predicted", () => {
    const r: Reconciliation = { status: "unprojected", actual: SAMPLE_DELTA };
    expect(describeReconciliation(r)).toBe("unprojected: stock.reserved changed with no projection");
  });

  it("TYPE-LEVEL: drifted requires both expected and actual — omitting either does not compile", () => {
    // @ts-expect-error — "drifted" requires `expected`; a bare `actual` is not enough to explain what was predicted.
    const bad: Reconciliation = { status: "drifted", actual: SAMPLE_DELTA };
    expect(bad).toBeDefined();
  });

  it("TYPE-LEVEL: a fourth status is not assignable to Reconciliation", () => {
    const bad: Reconciliation = {
      // @ts-expect-error — "escalated" is not one of the three real statuses; the union is closed.
      status: "escalated",
      matched: [],
    };
    expect(bad).toBeDefined();
  });
});

describe("assertNeverReconciliation: a fourth status fails to compile until handled everywhere", () => {
  /**
   * A literal simulation of "add a fourth Reconciliation status." This
   * type is NOT the real `Reconciliation` — the real one is frozen at
   * three variants for this milestone (plan's freeze boundary) — it exists
   * purely so this test can prove, at compile time, that
   * `assertNeverReconciliation`'s `never` parameter really does reject an
   * unhandled fourth case, without having to actually widen the frozen
   * type to demonstrate it.
   */
  type HypotheticalFourStatusReconciliation =
    | Reconciliation
    | { readonly status: "superseded"; readonly by: Delta };

  function handleAllFour(r: HypotheticalFourStatusReconciliation): string {
    switch (r.status) {
      case "confirmed":
        return "confirmed";
      case "drifted":
        return "drifted";
      case "unprojected":
        return "unprojected";
      case "superseded":
        return "superseded";
      default:
        return assertNeverReconciliation(r);
    }
  }

  function handleOnlyThree(r: HypotheticalFourStatusReconciliation): string {
    switch (r.status) {
      case "confirmed":
        return "confirmed";
      case "drifted":
        return "drifted";
      case "unprojected":
        return "unprojected";
      default:
        // @ts-expect-error — `r` is narrowed only to `{ status: "superseded"; by: Delta }` here (the one case not handled above), which is not assignable to `never`; a fourth status must fail to compile until every switch handling it adds a case.
        return assertNeverReconciliation(r);
    }
  }

  it("both functions above exist only to be typechecked by `npm run typecheck`; this runtime test confirms they're wired up as real functions", () => {
    expect(typeof handleAllFour).toBe("function");
    expect(typeof handleOnlyThree).toBe("function");
    expect(
      handleAllFour({ status: "confirmed", matched: [] }),
    ).toBe("confirmed");
  });
});
