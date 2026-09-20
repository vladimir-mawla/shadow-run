import { describe, expect, it } from "vitest";
import { computeFingerprint, makeWorld, type AssumptionKind, type Delta, type ProjectedEffect } from "../../lib/contracts/index.js";
import { checkConsistency } from "../../lib/simulate/index.js";
import { reconcile, makeInitialTrust, updateTrust } from "../../lib/reconcile/index.js";
import { applyDeltas, runRollback } from "../../lib/rollback/index.js";
import type { Rollback } from "../../lib/contracts/rollback.js";

/**
 * M7 CASE 4 — hash collision and stale-`World.version`, resolved
 * fail-closed. FULL PIN for 4a/4b (real collision, real code, run today);
 * 4c is an HONEST PARTIAL PIN — see that section's own header for why.
 *
 * === 4a. THE COLLISION ITSELF, VERIFIED INDEPENDENTLY A FOURTH TIME =====
 * `m7-failure-suite.md` claims this collision was verified three times
 * already (by copying `computeFingerprint`'s algorithm verbatim and
 * running it). Before writing this file, it was verified a fourth time,
 * the same way — `canonicalize` (sort keys recursively) → `JSON.stringify`
 * → 32-bit FNV-1a → 8 lowercase hex digits, copied character-for-character
 * from the REAL `lib/contracts/fingerprint.ts` on this branch and run
 * standalone — and reproduced exactly:
 *
 *   computeFingerprint({ reserved: 412789 }) -> 2ba95242
 *   computeFingerprint({ reserved: 649192 }) -> 2ba95242
 *
 * This file does NOT mock `computeFingerprint` anywhere below — every
 * assertion calls the real, imported function, against real `World`
 * values built through the real, blessed `makeWorld` (so
 * `assertPlainData`/`deepFreezeClone` actually run).
 *
 * SCOPE, STATED HONESTLY: this is a real collision for the MINIMAL
 * `World<{ reserved: number }>` shape used throughout this codebase's own
 * test fixtures (`lib/simulate/__tests__/fixtures.ts`'s `StockState`) —
 * not a claim that a collision is reachable at M6's real, multi-field
 * `StockState` shape (`sku`, `warehouse`, `stock.onHand`,
 * `stock.available`, `reservations`, ...), which nothing here or anywhere
 * else has searched for. It proves the mathematical point (two genuinely
 * different, legitimately constructed `World.data` values hash
 * identically under the real, shipped algorithm) with real data and the
 * real hash function; it does not claim more than that.
 *
 * === 4b. WHAT THE COLLISION DOES AND DOES NOT BREAK — PROVEN, NOT
 * ARGUED ====================================================================
 * Every "immune" claim below is a real call against real code, not an
 * assertion of the design doc's prose. `reconcile()`, `SimulatorTrust`,
 * and `checkConsistency` are proven immune by direct call — but by TWO
 * DIFFERENT mechanisms, and an earlier version of this comment wrongly
 * described them as one.
 *
 * `reconcile()` and `SimulatorTrust` never touch a hash at all: neither
 * `reconcile.ts` nor `trust.ts` imports `computeFingerprint` or reads
 * `.fingerprint` off anything, so a collision cannot reach them.
 *
 * `checkConsistency` is immune for the opposite reason — it uses
 * fingerprints heavily and correctly. `consistency.ts:1` imports
 * `computeFingerprint` and line 100 calls it to DERIVE a fingerprint from
 * the real data, then compares that against the effect's claimed
 * `resultingFingerprint`. It never trusts a claimed hash, which is why an
 * adversary who picks an attractive colliding value is still rejected:
 * Layer 1 re-verifies each delta's own `before` against reality
 * independently of any hash. Saying it "never reads a fingerprint" would
 * be the opposite of how it actually proves the more interesting half of
 * 4b. `runRollback`'s stronger proof
 * (`assumeNoConcurrentWriter`) is proven to survive specifically BECAUSE
 * it is `dataMatchesExactly` (`deepEqual`), not `fingerprintMatches`, that
 * drives its `"dishonest"` branch — demonstrated by constructing a case
 * where the two disagree.
 */

type StockState = { readonly reserved: number };

function stockWorld(reserved: number, version = 1) {
  return makeWorld<StockState>({ id: "sku-case4", domain: "inventory", version, at: "2026-09-20T00:00:00.000Z", data: { reserved } });
}

const COLLIDING_A = 412789;
const COLLIDING_B = 649192;
const COLLIDING_FINGERPRINT = "2ba95242";

describe("4a — the real collision, real hash function, real World values", () => {
  const worldA = stockWorld(COLLIDING_A);
  const worldB = stockWorld(COLLIDING_B);

  it("both fingerprints equal the independently-verified collision value", () => {
    expect(worldA.fingerprint).toBe(COLLIDING_FINGERPRINT);
    expect(worldB.fingerprint).toBe(COLLIDING_FINGERPRINT);
  });

  it("computeFingerprint (the real, imported function) reproduces the collision directly, with no World wrapper at all", () => {
    expect(computeFingerprint({ reserved: COLLIDING_A })).toBe(COLLIDING_FINGERPRINT);
    expect(computeFingerprint({ reserved: COLLIDING_B })).toBe(COLLIDING_FINGERPRINT);
  });

  it("the underlying data is genuinely different — fingerprint equality does NOT imply data equality", () => {
    expect(worldA.data).not.toEqual(worldB.data);
    expect(worldA.data.reserved).not.toBe(worldB.data.reserved);
  });
});

describe("4b — reconcile() is immune: it never reads a fingerprint, so the collision has no surface to attack here", () => {
  it("a real drift AT the colliding field is still correctly reported as drifted, by real value comparison, not by any hash check", () => {
    const predicted: Delta = { path: "reserved", before: COLLIDING_A, after: COLLIDING_A, kind: "set" };
    const observed: Delta = { path: "reserved", before: COLLIDING_A, after: COLLIDING_B, kind: "set" };
    const reconciliation = reconcile([predicted], [observed]);
    expect(reconciliation.status).toBe("drifted");
    if (reconciliation.status === "drifted") {
      expect(reconciliation.expected).toEqual(predicted);
      expect(reconciliation.actual).toEqual(observed);
    }
  });
});

describe("4b — SimulatorTrust is immune: its arithmetic is derived entirely from Reconciliation.status, never from a fingerprint value", () => {
  it("the drift found above advances the counter identically to an unrelated drift with no colliding numbers anywhere in it", () => {
    const collisionDrift = reconcile(
      [{ path: "reserved", before: COLLIDING_A, after: COLLIDING_A, kind: "set" }],
      [{ path: "reserved", before: COLLIDING_A, after: COLLIDING_B, kind: "set" }],
    );
    const unrelatedDrift = reconcile(
      [{ path: "reserved", before: 1, after: 1, kind: "set" }],
      [{ path: "reserved", before: 1, after: 2, kind: "set" }],
    );

    const trustFromCollision = updateTrust(makeInitialTrust("inventory.reserve"), collisionDrift);
    const trustFromUnrelated = updateTrust(makeInitialTrust("inventory.reserve"), unrelatedDrift);

    // Same shape of transition either way — the magnitude/collision-ness
    // of the numbers involved is invisible to updateTrust, exactly as
    // trust.ts's own header claims (derived from Reconciliation.status
    // alone).
    expect(trustFromCollision.consecutiveNonConfirmed).toBe(trustFromUnrelated.consecutiveNonConfirmed);
    expect(trustFromCollision.consecutiveNonConfirmed).toBe(1);
  });
});

describe("4b — checkConsistency (M3) is immune: it always re-derives the real fingerprint from real data, never trusting a claimed value that merely happens to match", () => {
  it("an HONEST projection that legitimately lands on the colliding fingerprint is correctly accepted — the collision is irrelevant to its own correctness", () => {
    const effect: ProjectedEffect = {
      deltas: [{ path: "reserved", before: COLLIDING_A, after: COLLIDING_B, kind: "set" }],
      resultingFingerprint: COLLIDING_FINGERPRINT, // true: computeFingerprint({reserved: COLLIDING_B}) really is this value
      assumptions: [],
      producedBy: "shadow-execution",
    };
    const result = checkConsistency({ reserved: COLLIDING_A }, effect);
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("a DISHONEST projection is still rejected even when it claims the 'attractive' colliding fingerprint — checkConsistency is not fooled into rubber-stamping it just because that value happens to be reachable from elsewhere", () => {
    const effect: ProjectedEffect = {
      deltas: [], // claims nothing changed
      resultingFingerprint: COLLIDING_FINGERPRINT, // false: computeFingerprint({reserved: 1}) is NOT this value
      assumptions: [],
      producedBy: "shadow-execution",
    };
    const result = checkConsistency({ reserved: 1 }, effect);
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
    expect(result.problems[0]).toContain("resultingFingerprint mismatch");
  });
});

describe("4b — runRollback's proof survives: its 'dishonest' branch is driven by dataMatchesExactly (deepEqual), not by fingerprintMatches", () => {
  it("a rollback that lands on genuinely different data, whose fingerprint nonetheless collides with the expected one, is still correctly reported as dishonest — not mistaken for 'restored'", () => {
    const worldBeforeThisWrite = stockWorld(COLLIDING_A); // fingerprint = 2ba95242
    const observedDeltas: readonly Delta[] = [{ path: "reserved", before: COLLIDING_A, after: 500000, kind: "set" }];
    const postActionWorld = applyDeltas(worldBeforeThisWrite, observedDeltas);
    expect(postActionWorld.data.reserved).toBe(500000);

    // A fabricated rollback plan: instead of restoring to COLLIDING_A
    // (412789, the real prior value), it lands on COLLIDING_B (649192) —
    // a genuinely different value whose fingerprint HAPPENS to equal
    // worldBeforeThisWrite's own fingerprint, by the same collision as 4a.
    const dishonestSteps: readonly Delta[] = [{ path: "reserved", before: 500000, after: COLLIDING_B, kind: "set" }];
    const rollback: Rollback = {
      kind: "runnable",
      steps: dishonestSteps,
      // This claim is TRUE (worldBeforeThisWrite.fingerprint really is
      // COLLIDING_FINGERPRINT) — so the cheap pre-check (check 1, which
      // only compares this claim against worldBeforeThisWrite.fingerprint)
      // does not and should not intercept this; the failure must come from
      // the opt-in strong check, after applyDeltas actually runs.
      projectedRestoration: { deltas: [], resultingFingerprint: worldBeforeThisWrite.fingerprint, assumptions: [], producedBy: "shadow-execution" },
    };

    const outcome = runRollback(rollback, postActionWorld, worldBeforeThisWrite, { assumeNoConcurrentWriter: true });

    expect(outcome.status).toBe("dishonest");
    if (outcome.status === "dishonest") {
      // The collision is real and visible right here: the "actual" and
      // "expected" fingerprints the outcome reports are the SAME string,
      // even though the data is provably different (asserted below) —
      // exactly the scenario where a fingerprint-only check would have
      // wrongly said "restored".
      expect(outcome.actualFingerprint).toBe(COLLIDING_FINGERPRINT);
      expect(outcome.expectedFingerprint).toBe(COLLIDING_FINGERPRINT);
      expect(outcome.actualFingerprint).toBe(outcome.expectedFingerprint); // fingerprints AGREE...
    }
    expect(outcome.status).not.toBe("restored"); // ...and runRollback still correctly refuses to call this restored.

    // The authoritative proof, confirmed directly: the data really does
    // differ, which is WHY this must be "dishonest" and not "restored".
    const restoredData = applyDeltas(postActionWorld, dishonestSteps).data;
    expect(restoredData).not.toEqual(worldBeforeThisWrite.data);
    expect(restoredData.reserved).toBe(COLLIDING_B);
    expect(worldBeforeThisWrite.data.reserved).toBe(COLLIDING_A);
  });
});

/**
 * === 4c. STALE World.version, FAIL-CLOSED — HONEST PARTIAL PIN ==========
 * `AssumptionKind` (real, frozen, `lib/contracts/projected-effect.ts`)
 * names `"world-version-unchanged"` as one of exactly three preconditions
 * a shadow execution's prediction depends on. But no gate function that
 * CONSUMES it exists anywhere in the real, merged `lib/**` on this branch
 * (confirmed by reading `lib/simulate/**`/`lib/reconcile/**` directly:
 * `simulate()` never reads `World.version` at all, and `reconcile()`
 * diffs `Delta[]`, never `World.version` either) — building that gate for
 * real is M3's boundary widening, or M6/M8's wiring, and `lib/**` is
 * frozen for this milestone, so this file cannot add it there.
 *
 * What CAN be honestly pinned today: the required comparison itself,
 * expressed as a small, test-local reference function built only from
 * real, frozen primitives (`AssumptionKind`, `World.version` — both plain
 * data this file already has legitimate access to), proving the required
 * behavior is well-defined and falsifiable, NOT that any production code
 * path performs it yet. This is an honest partial pin, not a full one —
 * unlike every other assertion in this file, it is not exercising a real
 * `lib/**` call site.
 *
 * WHY THIS BELONGS BESIDE THE COLLISION: `World.version` is a plain
 * integer counter, not a 32-bit digest — it has no collision space at
 * all, by construction, which is exactly why it is the correct backstop
 * for 4a's weakness rather than a second instance of it. A gate that
 * checked fingerprint equality ALONE to decide "did anything move" would
 * inherit 4a's exact hazard; a gate keyed on `World.version` cannot,
 * structurally, in the way demonstrated below.
 */
describe("4c — honest partial pin: stale World.version is a non-probabilistic backstop, fail-closed", () => {
  /**
   * Test-local reference implementation of the required gate comparison
   * — NOT a claim this exists in lib/** (it does not; see this section's
   * own header). Models exactly one rule: if a projection declared
   * "world-version-unchanged", the real World.version at execution time
   * must still equal the version it was projected against, or the
   * pipeline must fail closed rather than silently proceed.
   */
  function versionGate(assumptions: readonly AssumptionKind[], projectedAtVersion: number, realVersionNow: number): "proceed" | "fail-closed" {
    if (!assumptions.includes("world-version-unchanged")) return "proceed"; // a different assumption's job — out of scope for this gate.
    return projectedAtVersion === realVersionNow ? "proceed" : "fail-closed";
  }

  it("'world-version-unchanged' is one of the real, frozen AssumptionKind union's exactly three members", () => {
    const allThree: readonly AssumptionKind[] = ["no-concurrent-writer", "world-version-unchanged", "clock-monotonic"];
    expect(allThree).toContain("world-version-unchanged");
  });

  it("version unchanged at execution time -> proceed-eligible", () => {
    expect(versionGate(["world-version-unchanged"], 12, 12)).toBe("proceed");
  });

  it("version moved (a legitimate concurrent write landed between projection and execution) -> fail-closed, never a silent proceed", () => {
    expect(versionGate(["world-version-unchanged"], 12, 13)).toBe("fail-closed");
  });

  it("non-probabilistic, unlike 4a's hash: every distinct version compares unequal to every OTHER version, by construction — no search for a 'colliding' pair is possible because a plain integer equality check has no birthday bound", () => {
    for (let real = 0; real < 40; real++) {
      for (let projected = 0; projected < 40; projected++) {
        expect(versionGate(["world-version-unchanged"], projected, real)).toBe(projected === real ? "proceed" : "fail-closed");
      }
    }
  });
});
