import { describe, expect, it } from "vitest";
import type { Reconciliation } from "../../contracts/reconciliation.js";
import { DEFAULT_TRUST_THRESHOLD, makeInitialTrust, requiresPreValidatedRollback, updateTrust } from "../trust.js";

/**
 * M4 success criterion (plan §C, M4): "feeding a sequence of
 * reconciliations through `SimulatorTrust`'s counter mechanically flips
 * a `requiresPreValidatedRollback` ... boolean at the exact configured
 * threshold -- a test checks counter value N-1 doesn't flip it, N does,
 * and a single intervening `confirmed` resets the counter to `0` rather
 * than merely slowing its climb (never an EMA)."
 *
 * Every threshold-shaped assertion below is built FROM
 * `DEFAULT_TRUST_THRESHOLD`, never a bare literal re-typed independently
 * -- see trust.ts's own comment on that constant for why: if the
 * threshold ever changes, these tests move with it instead of quietly
 * asserting a number the code no longer uses.
 */

const DRIFTED: Reconciliation = {
  status: "drifted",
  expected: { path: "x", before: 1, after: 2, kind: "set" },
  actual: { path: "x", before: 1, after: 3, kind: "set" },
};
const UNPROJECTED: Reconciliation = {
  status: "unprojected",
  actual: { path: "y", before: false, after: true, kind: "set" },
};
const CONFIRMED: Reconciliation = { status: "confirmed", matched: [] };

describe("makeInitialTrust", () => {
  it("starts a fresh actionType at 0/0", () => {
    expect(makeInitialTrust("inventory.reserve")).toEqual({
      actionType: "inventory.reserve",
      consecutiveNonConfirmed: 0,
      totalObserved: 0,
    });
  });
});

describe("updateTrust: the reset-on-success arithmetic", () => {
  it("a confirmed reconciliation resets consecutiveNonConfirmed to 0 and still increments totalObserved", () => {
    const trust = { actionType: "a", consecutiveNonConfirmed: 5, totalObserved: 10 };
    expect(updateTrust(trust, CONFIRMED)).toEqual({ actionType: "a", consecutiveNonConfirmed: 0, totalObserved: 11 });
  });

  it("a drifted reconciliation increments consecutiveNonConfirmed by exactly 1", () => {
    const trust = makeInitialTrust("a");
    expect(updateTrust(trust, DRIFTED)).toEqual({ actionType: "a", consecutiveNonConfirmed: 1, totalObserved: 1 });
  });

  it("an unprojected reconciliation also increments consecutiveNonConfirmed by exactly 1 (drifted and unprojected are treated identically by the counter)", () => {
    const trust = makeInitialTrust("a");
    expect(updateTrust(trust, UNPROJECTED)).toEqual({ actionType: "a", consecutiveNonConfirmed: 1, totalObserved: 1 });
  });

  it("never mutates its input trust value", () => {
    const trust = makeInitialTrust("a");
    const frozen = Object.freeze({ ...trust });
    expect(() => updateTrust(frozen, DRIFTED)).not.toThrow();
    expect(frozen).toEqual({ actionType: "a", consecutiveNonConfirmed: 0, totalObserved: 0 });
  });
});

describe("requiresPreValidatedRollback: the exact threshold flip", () => {
  it(`N-1 (${DEFAULT_TRUST_THRESHOLD - 1}) consecutive non-confirmed reconciliations do NOT flip the gate`, () => {
    let trust = makeInitialTrust("inventory.reserve");
    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD - 1; i++) {
      trust = updateTrust(trust, DRIFTED);
    }
    expect(trust.consecutiveNonConfirmed).toBe(DEFAULT_TRUST_THRESHOLD - 1);
    expect(requiresPreValidatedRollback(trust)).toBe(false);
  });

  it(`N (${DEFAULT_TRUST_THRESHOLD}) consecutive non-confirmed reconciliations DO flip the gate`, () => {
    let trust = makeInitialTrust("inventory.reserve");
    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD; i++) {
      trust = updateTrust(trust, DRIFTED);
    }
    expect(trust.consecutiveNonConfirmed).toBe(DEFAULT_TRUST_THRESHOLD);
    expect(requiresPreValidatedRollback(trust)).toBe(true);
  });

  it("a mix of drifted and unprojected reconciliations both count toward the same threshold", () => {
    let trust = makeInitialTrust("inventory.reserve");
    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD; i++) {
      trust = updateTrust(trust, i % 2 === 0 ? DRIFTED : UNPROJECTED);
    }
    expect(requiresPreValidatedRollback(trust)).toBe(true);
  });

  it("a custom threshold overrides the default", () => {
    let trust = makeInitialTrust("inventory.reserve");
    for (let i = 0; i < 2; i++) trust = updateTrust(trust, DRIFTED);
    expect(requiresPreValidatedRollback(trust, 2)).toBe(true);
    expect(requiresPreValidatedRollback(trust, 5)).toBe(false);
  });
});

describe("requiresPreValidatedRollback: a single intervening confirmed RESETS the counter, it does not merely slow its climb", () => {
  it("drifting to N-1, confirming once, then drifting again requires a FULL new run of N to flip -- not just one more step", () => {
    let trust = makeInitialTrust("inventory.reserve");
    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD - 1; i++) trust = updateTrust(trust, DRIFTED);
    expect(requiresPreValidatedRollback(trust)).toBe(false);

    trust = updateTrust(trust, CONFIRMED);
    expect(trust.consecutiveNonConfirmed).toBe(0); // reset to 0, not N-2 (which "slowing the climb" would produce)

    // If the counter had merely been slowed rather than reset, a single
    // further drifted call (bringing a non-resetting statistic back up
    // near N-1) might already flip the gate. It must not: a full N-length
    // run from the reset point is required.
    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD - 1; i++) {
      trust = updateTrust(trust, DRIFTED);
      expect(requiresPreValidatedRollback(trust)).toBe(false);
    }
    trust = updateTrust(trust, DRIFTED);
    expect(requiresPreValidatedRollback(trust)).toBe(true);
  });

  it("STATED LIMITATION (not softened): an alternating confirmed/drifted domain never trips the gate, no matter how long it runs", () => {
    let trust = makeInitialTrust("flaky.domain");
    const cycles = DEFAULT_TRUST_THRESHOLD * 10; // far more non-confirmed events, lifetime, than the threshold
    for (let i = 0; i < cycles; i++) {
      trust = updateTrust(trust, DRIFTED);
      trust = updateTrust(trust, CONFIRMED);
    }
    expect(trust.totalObserved).toBe(cycles * 2);
    expect(requiresPreValidatedRollback(trust)).toBe(false); // this is the accepted trade, named in trust.ts/simulator-trust.ts -- not a bug.
  });
});
