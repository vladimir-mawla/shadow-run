import { describe, expect, it } from "vitest";
import { makeWorld, type World } from "../../lib/contracts/index.js";
import type { Delta } from "../../lib/contracts/delta.js";
import type { ProjectedEffect } from "../../lib/contracts/projected-effect.js";
import type { Rollback } from "../../lib/contracts/rollback.js";
import { applyDeltas, RollbackStepFailedError, runRollback } from "../../lib/rollback/index.js";

/**
 * M7 CASE 3 — `applyDeltas` failing partway through a `steps` list.
 *
 * THE DESIGN DOC IS STALE HERE, CORRECTED — STATED PLAINLY, AS INSTRUCTED:
 * `m7-failure-suite.md`'s Case 3 section (written before M5 merged) claims
 * "`RollbackFailed`... is not a value this suite can import — it does not
 * exist anywhere on `main` today, not even as a sketch" and labels this
 * case "not yet pinnable — a prescriptive specification, and the
 * weakest-grounded case in this suite." Both claims are false against the
 * REAL, merged `lib/rollback/**` this file reads directly:
 *
 *   - `RollbackStepFailedError` (thrown by `applyDeltas`,
 *     `lib/rollback/apply-deltas.ts:21`) is the named, typed failure the
 *     design doc predicted would need inventing. It carries `stepIndex`,
 *     `delta`, and `foundAtPath` — exactly the "which step, what cause"
 *     shape the doc's own `MalformedDeltaArrayError` precedent argued for,
 *     independently arrived at by M5's real author.
 *   - `RollbackOutcome["status"]` (`lib/rollback/run-rollback.ts`) has a
 *     real `"failed"` variant (`{ status: "failed"; reason; stepIndex;
 *     delta }`), the literal outcome PLAN.md's M7 criterion (3) calls
 *     `RollbackFailed` by name. It is distinct from `"restored"`,
 *     `"unavailable"`, AND `"dishonest"` — four variants, not the two the
 *     frozen `Rollback` (proposal) type has; `RollbackOutcome` (execution
 *     outcome) is exactly the new, separate type the design doc correctly
 *     predicted M5 would need to invent fresh, without being able to
 *     predict its real name or shape.
 *
 * So this case is a FULL PIN against real code, not the prescriptive
 * specification the stale design doc describes.
 *
 * THE DANGER THIS CASE PINS, PER THE BRIEF'S OWN FRAMING: a half-restored
 * world REPORTED AS RESTORED is worse than no rollback at all — every
 * downstream consumer that trusts "rollback succeeded" now holds a wrong
 * belief about the real world, with nothing to correct it. So every
 * assertion below is about the WORLD'S ACTUAL, OBSERVABLE CONDITION
 * afterward (is the original object identical, not merely "deep-equal
 * enough"; is the failure named; is the outcome's status field impossible
 * to mistake for success) — never merely "did something throw."
 */

type Fixture = {
  readonly stock: { readonly reserved: number; readonly available: number };
  readonly note: string | null;
};

function fixtureWorld(data: Fixture, version = 1): World<Fixture> {
  return makeWorld<Fixture>({ id: "sku-case3", domain: "inventory", version, at: "2026-09-20T00:00:00.000Z", data });
}

function projectionClaiming(fingerprint: string): ProjectedEffect {
  return { deltas: [], resultingFingerprint: fingerprint, assumptions: [], producedBy: "shadow-execution" };
}

describe("Case 3a — applyDeltas: a middle step (index 1 of 3) fails — the original World is provably untouched, not merely 'an error was thrown'", () => {
  it("throws RollbackStepFailedError naming step 1, and the ORIGINAL World argument is the exact same object, unchanged, afterward", () => {
    const world = fixtureWorld({ stock: { reserved: 39, available: 61 }, note: null });
    const originalDataRef = world.data; // identity, not just a snapshot — proves nothing even attempted a mutation
    const originalFingerprint = world.fingerprint;

    const steps: readonly Delta[] = [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" }, // step 0: individually well-formed, would succeed alone
      { path: "stock.available", before: 999, after: 5, kind: "set" }, // step 1: POISONED — real value is 61, not 999
      { path: "note", before: null, after: "unreachable", kind: "set" }, // step 2: individually well-formed, never reached
    ];

    let caught: unknown;
    try {
      applyDeltas(world, steps);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RollbackStepFailedError);
    const failure = caught as RollbackStepFailedError;
    expect(failure.stepIndex).toBe(1); // names exactly which step — not "something failed"
    expect(failure.delta).toEqual(steps[1]);
    expect(failure.foundAtPath).toBe(61); // what was actually there, vs. the 999 the poisoned step required

    // BYTE-FOR-BYTE UNCHANGED — the actual assertion this case requires,
    // not a side note: same object reference (nothing was even attempted
    // in place), and the same structural content.
    expect(world.data).toBe(originalDataRef);
    expect(world.data).toEqual({ stock: { reserved: 39, available: 61 }, note: null });
    expect(world.fingerprint).toBe(originalFingerprint);
    // Step 0 would have succeeded in isolation — proving this is a real
    // atomicity guarantee, not a coincidence of step 0 never running:
    expect(world.data.stock.reserved).toBe(39); // NOT 40/42 — step 0's own effect never became visible.
  });
});

describe("Case 3b — applyDeltas: the LAST step (index 2 of 3) fails — same guarantee, proved independently rather than assumed from the middle-step case", () => {
  it("throws RollbackStepFailedError naming step 2, with steps 0 and 1's effects never visible anywhere", () => {
    const world = fixtureWorld({ stock: { reserved: 39, available: 61 }, note: null });
    const originalDataRef = world.data;
    const originalFingerprint = world.fingerprint;

    const steps: readonly Delta[] = [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" }, // step 0: valid
      { path: "stock.available", before: 61, after: 58, kind: "set" }, // step 1: valid
      { path: "note", before: "WRONG-EXPECTED-VALUE", after: "unreachable", kind: "set" }, // step 2: POISONED — real value is null
    ];

    let caught: unknown;
    try {
      applyDeltas(world, steps);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RollbackStepFailedError);
    const failure = caught as RollbackStepFailedError;
    expect(failure.stepIndex).toBe(2);
    expect(failure.delta).toEqual(steps[2]);
    expect(failure.foundAtPath).toBe(null);

    expect(world.data).toBe(originalDataRef);
    expect(world.data).toEqual({ stock: { reserved: 39, available: 61 }, note: null });
    expect(world.fingerprint).toBe(originalFingerprint);
    // Steps 0 AND 1 both would have succeeded individually — neither's
    // effect leaked into the real World even though both ran cleanly
    // against the scratch copy before step 2 poisoned the whole attempt.
    expect(world.data.stock.reserved).toBe(39);
    expect(world.data.stock.available).toBe(61);
  });
});

describe("Case 3c — 'nothing applied because a step was invalid' is structurally distinguishable from 'nothing needed doing', via the real RollbackOutcome union", () => {
  it("'nothing needed doing' (an honest no-op rollback: steps: []) returns normally with status 'restored' — no exception, a real World handed back", () => {
    const preActionWorld = fixtureWorld({ stock: { reserved: 39, available: 61 }, note: null });
    const rollback: Rollback = {
      kind: "runnable",
      steps: [], // genuinely nothing to undo
      projectedRestoration: projectionClaiming(preActionWorld.fingerprint),
    };

    const outcome = runRollback(rollback, preActionWorld, preActionWorld, { assumeNoConcurrentWriter: true });
    expect(outcome.status).toBe("restored");
    if (outcome.status === "restored") {
      expect(outcome.world.data).toEqual(preActionWorld.data);
      expect(outcome.fullWorldRestorationVerified).toBe(true);
    }
  });

  it("'nothing applied because a step was invalid' (a poisoned last step) returns status 'failed' — never 'restored', never a World, and never silently swallowed", () => {
    const preActionWorld = fixtureWorld({ stock: { reserved: 39, available: 61 }, note: null });
    const postActionWorld = applyDeltas(preActionWorld, [
      { path: "stock.reserved", before: 39, after: 42, kind: "increment" },
    ]);

    const poisonedSteps: readonly Delta[] = [
      { path: "stock.available", before: 61, after: 58, kind: "set" }, // step 0: valid
      { path: "stock.reserved", before: 999, after: 39, kind: "increment" }, // step 1 (last): POISONED — real value is 42
    ];
    const rollback: Rollback = {
      kind: "runnable",
      steps: poisonedSteps,
      projectedRestoration: projectionClaiming(preActionWorld.fingerprint), // self-consistent claim, so the cheap pre-check does not intercept this
    };

    const outcome = runRollback(rollback, postActionWorld, preActionWorld);

    // The two outcomes ("restored" above, "failed" here) are DIFFERENT,
    // named members of the same real, frozen-shape RollbackOutcome union
    // — a caller branching on `.status` cannot confuse one for the other,
    // and neither branch carries a World alongside the other's meaning:
    expect(outcome.status).toBe("failed");
    expect(outcome.status).not.toBe("restored");
    if (outcome.status === "failed") {
      expect(outcome.stepIndex).toBe(1); // names exactly which step
      expect(outcome.delta).toEqual(poisonedSteps[1]);
      expect(outcome.reason).toContain("step 1");
    }
    // No World object exists on the "failed" branch at all — TypeScript
    // itself refuses `outcome.world` here (a compile error, not merely a
    // runtime absence), which is the type-level half of "never silently
    // swallowed as success."
  });
});
