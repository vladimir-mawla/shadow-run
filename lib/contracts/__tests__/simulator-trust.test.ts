import { describe, expect, it } from "vitest";
import type { SimulatorTrust } from "../simulator-trust.js";

/**
 * `SimulatorTrust` is the fifth, supporting type (plan §A.5's closing
 * note) — its actual reset-on-success arithmetic is M4's job
 * (`lib/reconcile/**`, a later freeze boundary). M1 only fixes its shape,
 * so these tests are shape/documentation tests, not behavior tests: they
 * pin the fields a later milestone is not free to rename or drop, and
 * record the counter-vs-EMA reasoning as an executable example rather
 * than prose only.
 */
describe("SimulatorTrust shape", () => {
  it("carries actionType, consecutiveNonConfirmed, and totalObserved", () => {
    const trust: SimulatorTrust = {
      actionType: "inventory.reserve",
      consecutiveNonConfirmed: 0,
      totalObserved: 12,
    };
    expect(trust.actionType).toBe("inventory.reserve");
    expect(trust.consecutiveNonConfirmed).toBe(0);
    expect(trust.totalObserved).toBe(12);
  });

  it("TYPE-LEVEL: omitting consecutiveNonConfirmed does not compile", () => {
    // @ts-expect-error — consecutiveNonConfirmed is required; a trust value with no counter is not a valid SimulatorTrust.
    const bad: SimulatorTrust = { actionType: "inventory.reserve", totalObserved: 12 };
    expect(bad).toBeDefined();
  });

  it("documents the reset-on-success arithmetic as data, without implementing M4's engine: a sample sequence and its expected counter trajectory", () => {
    // This is a fixture describing the INTENDED semantics (see
    // simulator-trust.ts's header for why reset-on-success, not an EMA),
    // not a call into any function — M4 owns the real implementation.
    type Step = "confirmed" | "drifted" | "unprojected";
    const sequence: readonly Step[] = ["drifted", "drifted", "confirmed", "drifted", "drifted", "drifted"];
    const expectedCounterAfterEachStep = [1, 2, 0, 1, 2, 3];

    let counter = 0;
    const actual: number[] = [];
    for (const step of sequence) {
      counter = step === "confirmed" ? 0 : counter + 1;
      actual.push(counter);
    }

    expect(actual).toEqual(expectedCounterAfterEachStep);
  });
});
