import { describe, expect, it } from "vitest";
import type { Delta } from "../../contracts/delta.js";
import { makeWorld } from "../../contracts/index.js";
import type { ProjectedEffect } from "../../contracts/projected-effect.js";
import type { Rollback } from "../../contracts/rollback.js";
import { applyDeltas } from "../apply-deltas.js";
import { buildRollbackSteps, runRollback, verifyStepsAreHonestInversion } from "../run-rollback.js";

type ReservationState = {
  readonly stock: { readonly reserved: number; readonly available: number };
  readonly outbox: readonly string[];
};

function world(data: ReservationState, version = 1) {
  return makeWorld<ReservationState>({
    id: "sku-42",
    domain: "inventory",
    version,
    at: "2026-09-20T00:00:00.000Z",
    data,
  });
}

function projectionFor(fingerprint: string): ProjectedEffect {
  // A minimal, honestly-shaped ProjectedEffect for test fixtures — the
  // fields runRollback actually reads (`resultingFingerprint`) are real;
  // the others are filled with the smallest valid values `ProjectedEffect`
  // (frozen, M1) allows, since this file is not testing M3's `simulate()`.
  return { deltas: [], resultingFingerprint: fingerprint, assumptions: [], producedBy: "shadow-execution" };
}

/**
 * M5 success criterion 2, THE HEADLINE DEMO (PLAN.md / plan §A.4), run in
 * the SIMPLE scenario where `assumeNoConcurrentWriter` is legitimate (no
 * other actor touches this `World.id` between action and rollback): run
 * the generic `applyDeltas` interpreter with a `runnable` rollback's
 * recorded `steps` against the REAL post-action `World`, and get back a
 * `World` whose `fingerprint` equals the PRE-action `World.fingerprint` —
 * real hash equality, computed by really running the interpreter on really
 * recorded data. See the `describe` block below this one for the scenario
 * where that assumption does NOT hold, which is the one ADR 0004 exists to
 * resolve correctly.
 */
describe("criterion 2 — end-to-end (no concurrent writer): simulate an action, then roll it back, then prove fingerprint equality", () => {
  it("restores the exact pre-action fingerprint after a multi-step, multi-path action", () => {
    const preActionWorld = world({ stock: { reserved: 39, available: 61 }, outbox: [] });

    // The "real post-action World" — built with THIS milestone's OWN
    // `applyDeltas`, standing in for what M3/M4's real execution would
    // have produced (M3/M4 are not on this branch — see lib/rollback/
    // path.ts's header on why this is legitimate: applyDeltas is the
    // canonical forward-AND-reverse interpreter, and using it to construct
    // a realistic fixture is not the same as importing from lib/simulate
    // or lib/reconcile, neither of which this file touches).
    const observedDeltas: readonly Delta[] = [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" },
      { path: "outbox", before: [], after: ["reservation-confirmed"], kind: "append" },
    ];
    const postActionWorld = applyDeltas(preActionWorld, observedDeltas);

    const steps = buildRollbackSteps(observedDeltas);
    const rollback: Rollback = {
      kind: "runnable",
      steps,
      projectedRestoration: projectionFor(preActionWorld.fingerprint),
    };

    const outcome = runRollback(rollback, postActionWorld, preActionWorld, { assumeNoConcurrentWriter: true });

    // eslint-disable-next-line no-console -- deliberate: this milestone's
    // report requires the actual pasted fingerprints, not an assertion
    // that they matched.
    console.log(
      "[M5 demo] pre-action fingerprint:",
      preActionWorld.fingerprint,
      "| post-action fingerprint:",
      postActionWorld.fingerprint,
      "| post-rollback fingerprint:",
      outcome.status === "restored" ? outcome.world.fingerprint : "(rollback did not restore)",
    );

    expect(outcome.status).toBe("restored");
    if (outcome.status === "restored") {
      expect(outcome.world.fingerprint).toBe(preActionWorld.fingerprint);
      expect(outcome.world.data).toEqual(preActionWorld.data);
      expect(outcome.fullWorldRestorationVerified).toBe(true);
    }
    // The post-action fingerprint really did differ from the pre-action one —
    // proving this test exercises a real state change, not a no-op.
    expect(postActionWorld.fingerprint).not.toBe(preActionWorld.fingerprint);
  });

  it("verifyStepsAreHonestInversion agrees the recorded steps really are this action's own deltas, inverted", () => {
    const observedDeltas: readonly Delta[] = [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" },
      { path: "outbox", before: [], after: ["reservation-confirmed"], kind: "append" },
    ];
    const honestSteps = buildRollbackSteps(observedDeltas);
    expect(verifyStepsAreHonestInversion(observedDeltas, honestSteps)).toBe(true);

    const tamperedSteps = [...honestSteps];
    tamperedSteps[0] = { ...(tamperedSteps[0] as Delta), after: 999 }; // fabricated
    expect(verifyStepsAreHonestInversion(observedDeltas, tamperedSteps)).toBe(false);
  });
});

/**
 * ADR 0004's central design question, surfaced by M6: what does rollback
 * restore TO? Restoring all the way back to a stale simulation snapshot
 * would ERASE a concurrent actor's legitimate write. This suite proves
 * the CHOSEN behavior (restore only the paths THIS action's own steps
 * touch, leave everything else exactly as the concurrent actor left it)
 * directly, and proves the REJECTED behavior really would have been wrong
 * by computing what it would have produced and showing it discards real
 * data.
 */
describe("concurrent writer — rollback restores THIS action's own write, not a stale simulation snapshot", () => {
  it("a concurrent write to a DIFFERENT path survives rollback intact; comparing to the stale snapshot would incorrectly flag this as wrong", () => {
    const preActionWorld = world({ stock: { reserved: 39, available: 61 }, outbox: [] });

    // THIS action's own observed effect: reserve 3 more units.
    const observedDeltas: readonly Delta[] = [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" },
    ];
    const worldRightAfterThisWrite = applyDeltas(preActionWorld, observedDeltas);

    // A CONCURRENT actor, after this write, appends a notification — a
    // real, legitimate, unrelated change to a different path.
    const concurrentWorld = applyDeltas(worldRightAfterThisWrite, [
      { path: "outbox", before: [], after: ["someone-else's-notification"], kind: "append" },
    ]);

    const steps = buildRollbackSteps(observedDeltas);
    const rollback: Rollback = {
      kind: "runnable",
      steps,
      projectedRestoration: projectionFor(preActionWorld.fingerprint),
    };

    // Rolling back against the world AS IT REALLY IS NOW (including the
    // concurrent write) — the correct target per ADR 0004's choice (b).
    // assumeNoConcurrentWriter is deliberately NOT set: it would be false
    // here, and this test exists specifically for the case where it is.
    const outcome = runRollback(rollback, concurrentWorld, preActionWorld);

    expect(outcome.status).toBe("restored");
    if (outcome.status === "restored") {
      expect(outcome.world.data.stock.reserved).toBe(39); // this action's own write, undone
      expect(outcome.world.data.outbox).toEqual(["someone-else's-notification"]); // concurrent write, PRESERVED
      // The general claim (fullWorldRestorationVerified: false — no
      // whole-World check was attempted) is exactly right here, and the
      // stronger claim would have been FALSE, correctly:
      expect(outcome.fullWorldRestorationVerified).toBe(false);
      expect(outcome.world.data).not.toEqual(preActionWorld.data); // by design: outbox differs
      expect(outcome.world.fingerprint).not.toBe(preActionWorld.fingerprint); // same reason
    }

    // Demonstrates, rather than just asserts, why option (a) (restore to
    // the stale simulation/pre-action snapshot) would have been WRONG:
    // it would have thrown away the concurrent actor's real write.
    expect(preActionWorld.data.outbox).toEqual([]); // the stale snapshot never saw it at all.
  });

  it("a concurrent write to the SAME path fails closed (never overwrites the concurrent actor's value)", () => {
    const preActionWorld = world({ stock: { reserved: 39, available: 61 }, outbox: [] });
    const observedDeltas: readonly Delta[] = [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" },
    ];
    const worldRightAfterThisWrite = applyDeltas(preActionWorld, observedDeltas);

    // A concurrent actor ALSO changes stock.reserved — the conflicting case.
    const concurrentWorld = applyDeltas(worldRightAfterThisWrite, [
      { path: "stock.reserved", before: 42, after: 50, kind: "increment" },
    ]);

    const steps = buildRollbackSteps(observedDeltas); // expects stock.reserved to be 42, but it is now 50
    const rollback: Rollback = {
      kind: "runnable",
      steps,
      projectedRestoration: projectionFor(preActionWorld.fingerprint),
    };

    const outcome = runRollback(rollback, concurrentWorld, preActionWorld);
    expect(outcome.status).toBe("failed"); // fails closed — never silently overwrites the concurrent actor's 50.
    if (outcome.status === "failed") {
      expect(outcome.delta.path).toBe("stock.reserved");
    }
    // Proves the fail-closed guarantee directly: the concurrent actor's
    // write is still there, untouched, because applyDeltas never mutates
    // a real World and returns nothing on failure (apply-deltas.ts).
    expect(concurrentWorld.data.stock.reserved).toBe(50);
  });
});

describe("order — steps must be applied in REVERSE recorded order, proved with two deltas on the same path", () => {
  it("two appends to the same path: reversed order restores correctly; forward order fails loudly", () => {
    const preActionWorld = world({ stock: { reserved: 0, available: 100 }, outbox: [] });
    const observedDeltas: readonly Delta[] = [
      { path: "outbox", before: [], after: ["first"], kind: "append" },
      { path: "outbox", before: ["first"], after: ["first", "second"], kind: "append" },
    ];
    const postActionWorld = applyDeltas(preActionWorld, observedDeltas);
    expect(postActionWorld.data.outbox).toEqual(["first", "second"]);

    const reversedSteps = buildRollbackSteps(observedDeltas); // [invert(D2), invert(D1)]
    const restored = applyDeltas(postActionWorld, reversedSteps);
    expect(restored.data).toEqual(preActionWorld.data);
    expect(restored.fingerprint).toBe(preActionWorld.fingerprint);

    // The WRONG order (matching sim-plan.md §A.4's literal, unreversed
    // `.map(invertDelta)` sketch) fails immediately and loudly, rather
    // than silently restoring the wrong state — see run-rollback.ts's
    // header for why this is the direct justification for reversing.
    // This is `observedDeltas.map(invertDelta)` with NO reversal: first
    // step expects `outbox` to be `["first"]` (undoing D1), but the real
    // `postActionWorld` has `["first", "second"]` — a mismatch that
    // `applyDeltas`'s per-step verification catches immediately.
    const invertedInForwardOrder: readonly Delta[] = observedDeltas.map((d) => ({
      ...d,
      kind: "remove" as const,
      before: d.after,
      after: d.before,
    }));
    expect(() => applyDeltas(postActionWorld, invertedInForwardOrder)).toThrow();
  });
});

describe("runRollback — unavailable is a valid, non-crashing outcome", () => {
  it("returns a typed 'unavailable' result without attempting to apply anything, and never throws", () => {
    const postActionWorld = world({ stock: { reserved: 0, available: 100 }, outbox: ["already-sent"] });
    const rollback: Rollback = {
      kind: "unavailable",
      reason: "sending a notification has no compensating operation — the recipient cannot un-read it",
      blastRadius: [{ path: "outbox", before: [], after: ["already-sent"], kind: "append" }],
    };
    const outcome = runRollback(rollback, postActionWorld, postActionWorld);
    expect(outcome).toEqual({
      status: "unavailable",
      reason: rollback.reason,
      blastRadius: rollback.blastRadius,
    });
  });
});

describe("runRollback — failed vs dishonest, kept distinct on purpose", () => {
  it("'failed': applyDeltas throws partway through steps — surfaced explicitly, never silently treated as success", () => {
    const preActionWorld = world({ stock: { reserved: 39, available: 61 }, outbox: [] });
    const postActionWorld = applyDeltas(preActionWorld, [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" },
    ]);

    // A rollback plan whose steps don't actually match what's really in
    // postActionWorld (a fabricated/stale plan) — this is exactly the
    // "half-restored world" danger this milestone's brief names.
    const badSteps: readonly Delta[] = [{ path: "stock.reserved", before: 999, after: 39, kind: "increment" }];
    const rollback: Rollback = {
      kind: "runnable",
      steps: badSteps,
      projectedRestoration: projectionFor(preActionWorld.fingerprint), // claim is self-consistent...
    };

    const outcome = runRollback(rollback, postActionWorld, preActionWorld);
    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") {
      expect(outcome.stepIndex).toBe(0);
      expect(outcome.delta).toEqual(badSteps[0]);
    }
    // Never mistaken for "restored":
    expect(outcome.status).not.toBe("restored");
  });

  it("'dishonest' (cheap pre-check): the rollback's OWN claimed fingerprint disagrees with the known-good expectation — rejected before running anything", () => {
    const preActionWorld = world({ stock: { reserved: 39, available: 61 }, outbox: [] });
    const postActionWorld = applyDeltas(preActionWorld, [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" },
    ]);
    const rollback: Rollback = {
      kind: "runnable",
      steps: [{ path: "stock.reserved", before: 42, after: 39, kind: "increment" }],
      projectedRestoration: projectionFor("00000000"), // a fabricated claim, disagreeing with reality
    };
    const outcome = runRollback(rollback, postActionWorld, preActionWorld);
    expect(outcome.status).toBe("dishonest");
    if (outcome.status === "dishonest") {
      expect(outcome.claimedFingerprint).toBe("00000000");
      expect(outcome.expectedFingerprint).toBe(preActionWorld.fingerprint);
      expect(outcome.actualFingerprint).toBeUndefined(); // rejected before applyDeltas ever ran
    }
  });

  it("'dishonest' (the real proof, post-run, opt-in strong check): steps run with NO error but restore the wrong FULL state anyway", () => {
    const preActionWorld = world({ stock: { reserved: 39, available: 61 }, outbox: [] });
    const postActionWorld = applyDeltas(preActionWorld, [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" },
    ]);
    // Steps that apply cleanly (their own "before" matches reality) but
    // land on the WRONG "after" — a domain's honest-looking but incorrect
    // compensating steps, self-consistent with its own (also wrong) claim.
    // This is caught ONLY by the opt-in `assumeNoConcurrentWriter` strong
    // check — without it, `applyDeltas` succeeding is, correctly, all this
    // function can promise by default (see run-rollback.ts's header).
    const wrongButCleanSteps: readonly Delta[] = [
      { path: "stock.reserved", before: 42, after: 40, kind: "increment" }, // should be 39, not 40
    ];
    const rollback: Rollback = {
      kind: "runnable",
      steps: wrongButCleanSteps,
      projectedRestoration: projectionFor(preActionWorld.fingerprint), // claims it restores the real prior fingerprint...
    };
    const outcome = runRollback(rollback, postActionWorld, preActionWorld, { assumeNoConcurrentWriter: true });
    // ...but the cheap check only compares the CLAIM to the expectation (both
    // say preActionWorld.fingerprint), so it passes; only actually RUNNING
    // the steps and checking the opt-in strong claim reveals the real
    // result differs. This is the case the cheap check cannot catch alone.
    expect(outcome.status).toBe("dishonest");
    if (outcome.status === "dishonest") {
      expect(outcome.actualFingerprint).toBeDefined();
      expect(outcome.actualFingerprint).not.toBe(preActionWorld.fingerprint);
    }

    // Without opting in, the SAME bad steps are reported as "restored" —
    // documented here explicitly so this asymmetry is never mistaken for
    // a bug: it is the honest limit of what can be known without either
    // the no-concurrent-writer assumption or `verifyStepsAreHonestInversion`
    // against the original `observedDeltas` (see that function's own
    // header for why it, not this weaker default, is the always-valid fix).
    const outcomeWithoutAssumption = runRollback(rollback, postActionWorld, preActionWorld);
    expect(outcomeWithoutAssumption.status).toBe("restored");
  });
});
