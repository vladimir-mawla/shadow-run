import { describe, expect, it } from "vitest";
import { simulate } from "../../lib/simulate/index.js";
import { calendarC1, calendarC2 } from "../calendar/cases.js";
import { inventoryInv1, inventoryInv2, inventoryInv3, inv3UnrelatedConcurrentDelta } from "../inventory/cases.js";
import { notificationN1 } from "../notification/cases.js";
import { infraI1 } from "../infra/cases.js";
import { applyDeltas } from "../../lib/rollback/index.js";

/**
 * The task this milestone was handed is explicit: `m6-domain-cases.md`'s
 * fingerprints are claimed to be "real computed fingerprints... extracted
 * `fingerprint.ts`'s algorithm and hashed the literal JSON" — "Verify its
 * fingerprints against the actual `computeFingerprint` rather than
 * trusting the document — if any differ, the document is wrong and you
 * should report it, not silently match it." This file is that
 * verification, run for real against this milestone's own case data
 * (built from the SAME literal `World.data` JSON the design doc quotes),
 * not merely re-asserted from the document's prose.
 *
 * RESULT, SUMMARIZED HERE AND IN FULL IN
 * `.genesis/decisions/0005-domains.md`: every `World.data` snapshot
 * fingerprint the design doc quotes verified exactly. ONE claimed
 * `ProjectedEffect.resultingFingerprint` did NOT: INV-2's own projected
 * effect is claimed to hash identically to INV-1's ("1eb693c6") even
 * though the two actions append a reservation with a DIFFERENT
 * `createdAt` timestamp (INV-1: `...T14:03:00Z`, INV-2: `...T14:03:07Z`)
 * — two structurally different `World.data` values cannot share a
 * `computeFingerprint` hash (see `fingerprint.ts`'s own file header: the
 * hash depends only on `data`, and two different `data` values hashing
 * identically would be an actual FNV-1a collision, not merely unlikely at
 * this sample size — ADR 0001's ~77,000-sample birthday-bound note does
 * not apply to two SPECIFIC, deliberately-chosen values). The test below
 * proves this directly rather than silently using whichever value made
 * the suite pass.
 */
describe("m6-domain-cases.md's quoted World.data fingerprints, verified against the real computeFingerprint", () => {
  it("C1 input World — design doc claims 8cc1c48d", () => {
    expect(calendarC1.initialWorld.fingerprint).toBe("8cc1c48d");
  });

  it("C1's real post-state (feeding C2) — design doc claims c66c8be1", () => {
    const real = calendarC1.adapter.applyReal(calendarC1.action, calendarC1.initialWorld).world;
    expect(real.fingerprint).toBe("c66c8be1");
    // And C2's own starting World (built independently in cases.ts by re-running applyReal, not
    // by copying this fingerprint) agrees — proving the two were not allowed to drift apart.
    expect(calendarC2.initialWorld.fingerprint).toBe("c66c8be1");
  });

  it("C2's real post-state — design doc claims 29803daf", () => {
    const real = calendarC2.adapter.applyReal(calendarC2.action, calendarC2.initialWorld).world;
    expect(real.fingerprint).toBe("29803daf");
  });

  it("INV-1/INV-2's shared T0 input World — design doc claims e4bd0b35", () => {
    expect(inventoryInv1.initialWorld.fingerprint).toBe("e4bd0b35");
    expect(inventoryInv2.initialWorld.fingerprint).toBe("e4bd0b35");
  });

  it("INV-1's real post-state — design doc claims 1eb693c6", () => {
    const real = inventoryInv1.adapter.applyReal(inventoryInv1.action, inventoryInv1.initialWorld).world;
    expect(real.fingerprint).toBe("1eb693c6");
  });

  it("INV-2's injected W1 (the real, concurrent pre-write World) — design doc claims d0707049", () => {
    const w1 = inventoryInv2.injectConcurrentWrite?.(inventoryInv2.initialWorld);
    expect(w1?.fingerprint).toBe("d0707049");
  });

  it("INV-2's real post-write World (W2) — design doc claims 38911b5c", () => {
    const w1 = inventoryInv2.injectConcurrentWrite?.(inventoryInv2.initialWorld);
    if (!w1) throw new Error("expected INV-2 to inject a concurrent write");
    const w2 = inventoryInv2.adapter.applyReal(inventoryInv2.action, w1).world;
    expect(w2.fingerprint).toBe("38911b5c");
  });

  it("INV-2's rollback restores to a World fingerprinting identically to W1 (d0707049) — the plan's §B hash-equality proof, re-run here independently of the demo script", () => {
    const w1 = inventoryInv2.injectConcurrentWrite?.(inventoryInv2.initialWorld);
    if (!w1) throw new Error("expected INV-2 to inject a concurrent write");
    const { world: w2, observedDeltas } = inventoryInv2.adapter.applyReal(inventoryInv2.action, w1);
    const rollback = inventoryInv2.adapter.proposeRollback(observedDeltas, w1);
    if (rollback.kind !== "runnable") throw new Error("expected INV-2's rollback to be runnable");
    const restored = applyDeltas(w2, rollback.steps);
    expect(restored.fingerprint).toBe("d0707049");
    expect(restored.fingerprint).toBe(w1.fingerprint);
  });

  it("INV-3 input World — design doc claims c218015f", () => {
    expect(inventoryInv3.initialWorld.fingerprint).toBe("c218015f");
  });

  it("INV-3's real post-state, AFTER both this action's write and the injected concurrent write-off — design doc claims 45a9011f", () => {
    const { world: afterReservation } = inventoryInv3.adapter.applyReal(inventoryInv3.action, inventoryInv3.initialWorld);
    const afterEverything = applyDeltas(afterReservation, [inv3UnrelatedConcurrentDelta]);
    expect(afterEverything.fingerprint).toBe("45a9011f");
  });

  it("N1 input World — design doc claims d77e086e", () => {
    expect(notificationN1.initialWorld.fingerprint).toBe("d77e086e");
  });

  it("N1's real post-state — design doc claims 3a0a2407", () => {
    const real = notificationN1.adapter.applyReal(notificationN1.action, notificationN1.initialWorld).world;
    expect(real.fingerprint).toBe("3a0a2407");
  });

  it("I1 input World — design doc claims 6c1164f5", () => {
    expect(infraI1.initialWorld.fingerprint).toBe("6c1164f5");
  });

  it("I1's real post-state — design doc claims eb942396", () => {
    const real = infraI1.adapter.applyReal(infraI1.action, infraI1.initialWorld).world;
    expect(real.fingerprint).toBe("eb942396");
  });

  it("I1's rollback restores exactly to the input World's fingerprint (6c1164f5)", () => {
    const { world: real, observedDeltas } = infraI1.adapter.applyReal(infraI1.action, infraI1.initialWorld);
    const rollback = infraI1.adapter.proposeRollback(observedDeltas, infraI1.initialWorld);
    if (rollback.kind !== "runnable") throw new Error("expected I1's rollback to be runnable");
    const restored = applyDeltas(real, rollback.steps);
    expect(restored.fingerprint).toBe("6c1164f5");
  });
});

/**
 * `resultingFingerprint` claims — computed by `simulate()` itself (the
 * real engine, via each domain's real `project()`), not re-derived here.
 */
describe("m6-domain-cases.md's quoted ProjectedEffect.resultingFingerprint values, verified against simulate()", () => {
  it("C1's projected resultingFingerprint — design doc claims c66c8be1", () => {
    const result = simulate(calendarC1.action, calendarC1.initialWorld, { project: calendarC1.adapter.project });
    if (!result.ok) throw new Error("expected simulate() to succeed");
    expect(result.effect.resultingFingerprint).toBe("c66c8be1");
  });

  it("C2's projected resultingFingerprint — design doc claims 29803daf", () => {
    const result = simulate(calendarC2.action, calendarC2.initialWorld, { project: calendarC2.adapter.project });
    if (!result.ok) throw new Error("expected simulate() to succeed");
    expect(result.effect.resultingFingerprint).toBe("29803daf");
  });

  it("INV-1's projected resultingFingerprint — design doc claims 1eb693c6", () => {
    const result = simulate(inventoryInv1.action, inventoryInv1.initialWorld, { project: inventoryInv1.adapter.project });
    if (!result.ok) throw new Error("expected simulate() to succeed");
    expect(result.effect.resultingFingerprint).toBe("1eb693c6");
  });

  it("N1's projected resultingFingerprint — design doc claims 3a0a2407", () => {
    const result = simulate(notificationN1.action, notificationN1.initialWorld, { project: notificationN1.adapter.project });
    if (!result.ok) throw new Error("expected simulate() to succeed");
    expect(result.effect.resultingFingerprint).toBe("3a0a2407");
  });

  it("I1's projected resultingFingerprint — design doc claims eb942396", () => {
    const result = simulate(infraI1.action, infraI1.initialWorld, { project: infraI1.adapter.project });
    if (!result.ok) throw new Error("expected simulate() to succeed");
    expect(result.effect.resultingFingerprint).toBe("eb942396");
  });

  it("INV-3's projected resultingFingerprint — design doc claims 216a3e9b", () => {
    const result = simulate(inventoryInv3.action, inventoryInv3.initialWorld, { project: inventoryInv3.adapter.project });
    if (!result.ok) throw new Error("expected simulate() to succeed");
    expect(result.effect.resultingFingerprint).toBe("216a3e9b");
  });

  it("DOCUMENT ERROR, confirmed: INV-2's projected resultingFingerprint is NOT 1eb693c6 (INV-1's value, reused verbatim in the design doc) — it genuinely differs, because the appended reservation's createdAt differs", () => {
    const result = simulate(inventoryInv2.action, inventoryInv2.initialWorld, { project: inventoryInv2.adapter.project });
    if (!result.ok) throw new Error("expected simulate() to succeed");
    // The design doc's own claim for INV-2 ("identical to INV-1's projection except the timestamp",
    // yet quoting the SAME resultingFingerprint "1eb693c6" as INV-1) is internally inconsistent: a
    // different `createdAt` inside the appended reservation object makes `World.data` genuinely
    // different, so it CANNOT hash the same as INV-1's real 1eb693c6 without an actual FNV-1a
    // collision. This assertion proves the document's number does not hold, rather than silently
    // matching it.
    expect(result.effect.resultingFingerprint).not.toBe("1eb693c6");
  });
});
