import { describe, expect, it } from "vitest";
import type { Delta, Reconciliation, World } from "../../lib/contracts/index.js";
import { simulate, type Action } from "../../lib/simulate/index.js";
import { reconcile } from "../../lib/reconcile/index.js";
import { runRollback, verifyStepsAreHonestInversion } from "../../lib/rollback/index.js";
import { netDeltas } from "../../domains/index.js";
import { inventoryDomain, type StockState } from "../../domains/inventory/domain.js";
import { inventoryInv2 } from "../../domains/inventory/cases.js";

/**
 * M7 CASE 1 — THE §B TOCTOU SCENARIO, PINNED AGAINST THE REAL, MERGED M6
 * INVENTORY DOMAIN. FULL PIN, with one discovered nuance flagged plainly
 * below rather than smoothed over (see "WHAT THIS FILE FOUND").
 *
 * THE DESIGN DOC IS STALE HERE, IN A WAY WORTH NAMING BEFORE ANYTHING
 * ELSE: `m7-failure-suite.md`'s Case 1 section (written before M6 merged)
 * sketches `observed = diff(W1, W2)` and `steps = observed.map(invertDelta)`
 * as if a single hand-assembled `Delta[]` were the whole story. The real,
 * merged `domains/inventory/domain.ts` does something more specific:
 * `project()`/`applyReal()` both return the RAW, un-netted pipeline
 * (`growArraySteps`'s two-step `remove`-then-`append` for `reservations`,
 * per ADR 0005 §1's discovered M3/M5 `append` conflict), and
 * `proposeRollback` calls the real `buildRollbackSteps` (reverse + invert),
 * never a bare `.map(invertDelta)` in forward order — the reversal matters
 * the moment more than one step touches an overlapping path, which this
 * exact case does (two `reservations` steps). Every call below goes
 * through the domain's own real functions rather than reimplementing them.
 *
 * WHY THIS DOES NOT NEED A `lib/**`/`domains/**` CHANGE: nothing below
 * modifies frozen code — `git diff origin/main -- lib domains` stays
 * empty. Every gap this file had to work around (see next section) is
 * closed by choosing HOW to call already-real, already-frozen functions,
 * never by editing them.
 *
 * === WHAT THIS FILE FOUND, CHECKED BY ACTUALLY RUNNING IT, NOT ASSUMED ===
 * `sim-plan.md` §B's own headline sentence and `PLAN.md`'s M7 criterion
 * (1) both say reconciliation "names the exact field that drifted
 * (`stock.reserved`: predicted 42, observed 45)" — worded as if feeding
 * the WHOLE observed/predicted pipeline through one `reconcile()` call
 * naturally surfaces that field. It does not, and this was verified by
 * actually running it before writing this assertion, not assumed from the
 * design doc: `reconcile()`'s own documented priority rule (`reconcile.ts`'s
 * header, "MULTIPLE DELTAS DRIFTING AT ONCE") reports exactly ONE fact per
 * call, chosen by ascending lexicographic `path`. In THIS case, THREE
 * paths change (`stock.reserved`, `stock.available`, `reservations`), and
 * `reservations` ALSO drifted — the observed side's `before` snapshot
 * legitimately includes `ord-5534`'s own concurrent reservation
 * (`res-9035`), which the predicted side (computed against `T0`, before
 * that write) never saw — and `"reservations"` sorts alphabetically before
 * `"stock.reserved"`. So a single, unsliced `reconcile()` call over the
 * full pipeline reports `DRIFTED at "reservations"`, exactly what
 * `npm run demo:domains` itself prints for this exact case today — not
 * `"stock.reserved"`. This is confirmed as a real, reproducible fact below
 * (`describe("1a" ...)`'s first test), not merely asserted in a comment a
 * reader would have to trust.
 *
 * This is NOT a bug in `reconcile()` — it is doing exactly what its own
 * frozen header already documents and defends ("a caller that needs to
 * see every drifted/unprojected path in one execution... must call
 * `reconcile()` per-path itself, e.g. by slicing the two `Delta[]`s").
 * §B's literal sentence is pinned below by taking that same documented,
 * real, sanctioned slicing technique — filtering both sides to
 * `path === "stock.reserved"` before calling the same real `reconcile()` —
 * never by fabricating a different predicted/observed pair. Both the
 * unsliced (real, multi-field) result and the sliced (single-field, §B's
 * exact sentence) result are asserted below, side by side, so neither
 * reading is hidden behind the other.
 *
 * === ASSUMENOCONCURRENTWRITER — CHECKED FOR THIS FLOW, NOT INHERITED ===
 * ADR 0005 §2 argues INV-2's `assumeNoConcurrentWriter: true` is honest in
 * `scripts/demo-domains.ts`'s `runCase()` because nothing in that
 * synchronous flow writes to `inv-SKU-77021` again between this action's
 * own write (`W2`) and the rollback call. This file's own flow was
 * checked against that same requirement directly, not assumed to inherit
 * it: between building `w2` (`applyReal` for `ord-5533`) and calling
 * `runRollback` a few lines later, nothing in this file (or anything it
 * calls) performs a third write to this `World.id` — the flow is
 * synchronous and linear, identically shaped to `runCase()`'s own
 * simulate → inject → execute → reconcile → rollback sequence, just
 * driven directly rather than through the wiring script. The
 * justification transfers to this flow for the same reason it holds in
 * the demo: it is a fact about this file's own control flow, checked here,
 * not borrowed on the assumption that "it's the same domain" would be
 * enough on its own.
 */

const CONCURRENT_ACTION: Action = {
  domain: "inventory",
  type: "reserve",
  params: { orderId: "ord-5534", qty: 3, reservationId: "res-9035", createdAt: "2026-09-20T14:03:05Z" },
};

describe("Case 1a — the real M6 inventory pipeline, driven end to end: project() -> real concurrent write -> execute -> reconcile()", () => {
  const t0: World<StockState> = inventoryInv2.initialWorld;
  const action: Action = inventoryInv2.action;

  // Real concurrent write: ord-5534's OWN reservation, executed for real
  // through the domain's own applyReal() against T0 -- never a hand-built
  // World literal standing in for "what a concurrent write would produce".
  const w1 = inventoryDomain.applyReal(CONCURRENT_ACTION, t0).world;

  it("the concurrent write, run for real through applyReal(), lands on the exact fingerprint M6 already verified (d0707049) -- not merely asserted, reproduced", () => {
    expect(w1.fingerprint).toBe("d0707049");
    expect(w1.data.stock.reserved).toBe(40);
    expect(w1.data.stock.available).toBe(110);
    expect(w1.data.reservations).toHaveLength(2);
  });

  // project() runs against T0 -- the pre-state, before the concurrent
  // write -- through the real simulate() engine (all four fail-closed
  // gates included), never the domain's project() called bypassing them.
  const simResult = simulate(action, t0, { project: inventoryDomain.project });
  if (!simResult.ok) throw new Error(`unreachable for this fixture: ${JSON.stringify(simResult.failure)}`);
  const projectedRaw: ReadonlyArray<Delta> = simResult.effect.deltas;

  // Execute: this action's own applyReal(), against W1 -- the REAL,
  // already-raced world -- never against the stale T0 snapshot.
  const { world: w2, observedDeltas } = inventoryDomain.applyReal(action, w1);

  it("execution against the real, already-raced W1 lands on the exact fingerprint M6 already verified (38911b5c)", () => {
    expect(w2.fingerprint).toBe("38911b5c");
    expect(w2.data.stock.reserved).toBe(45);
  });

  // netDeltas -- the one and only place this milestone's own domains net
  // the raw growArraySteps pipeline down to one Delta per path, per ADR
  // 0005 §1 -- applied here exactly the way scripts/demo-domains.ts
  // applies it, immediately before handing either side to reconcile().
  const projectedNet = netDeltas(projectedRaw);
  const observedNet = netDeltas(observedDeltas);

  it("FOUND, NOT ASSUMED: the unsliced, full-pipeline reconcile() call reports drifted at \"reservations\" -- not \"stock.reserved\" -- because reservations sorts first AND also genuinely drifted (its own before-snapshot differs due to the same race)", () => {
    const reconciliation: Reconciliation = reconcile(projectedNet, observedNet);
    expect(reconciliation.status).toBe("drifted");
    if (reconciliation.status === "drifted") {
      expect(reconciliation.expected.path).toBe("reservations");
      expect(reconciliation.actual.path).toBe("reservations");
    }
  });

  it('§B\'s exact headline sentence, pinned via reconcile.ts\'s own documented per-path slice: DRIFTED at "stock.reserved", predicted 42, observed 45', () => {
    const predictedReservedOnly = projectedNet.filter((d) => d.path === "stock.reserved");
    const observedReservedOnly = observedNet.filter((d) => d.path === "stock.reserved");
    const reconciliation: Reconciliation = reconcile(predictedReservedOnly, observedReservedOnly);

    expect(reconciliation.status).toBe("drifted");
    if (reconciliation.status === "drifted") {
      expect(reconciliation.expected).toEqual({ path: "stock.reserved", before: 37, after: 42, kind: "increment" });
      expect(reconciliation.actual).toEqual({ path: "stock.reserved", before: 40, after: 45, kind: "increment" });
    }
  });

  describe("Case 1b — rollback: steps derived from observedDeltas (never hand-written), restoration proven by structural deep-equality, fingerprint corroborating only, the concurrent write survives untouched", () => {
    // The rollback proposal comes ENTIRELY from the domain's own real
    // proposeRollback(observedDeltas, w1) -- this file never constructs a
    // `steps` array by hand anywhere.
    const rollback = inventoryDomain.proposeRollback(observedDeltas, w1);

    it("the proposed steps are a real, independently-recomputed honest inversion of observedDeltas -- not fabricated, not hand-typed into this test", () => {
      expect(rollback.kind).toBe("runnable");
      if (rollback.kind === "runnable") {
        expect(verifyStepsAreHonestInversion(observedDeltas, rollback.steps)).toBe(true);
      }
    });

    it("running the real rollback restores W2 to data that is STRUCTURALLY deep-equal to W1 -- the assertion this pin rests on -- with fingerprint equality asserted only alongside, as corroboration, never as the sole proof (see Case 4: {reserved:412789}/{reserved:649192} both hash to 2ba95242 in this exact domain's own field)", () => {
      const outcome = runRollback(rollback, w2, w1, { assumeNoConcurrentWriter: true });

      expect(outcome.status).toBe("restored");
      if (outcome.status !== "restored") return;

      // THE PIN: structural deep-equality of the restored data against the
      // pre-write state, independent of any hash.
      expect(outcome.world.data).toEqual(w1.data);
      expect(outcome.fullWorldRestorationVerified).toBe(true);

      // Corroborating, not load-bearing: fingerprint equality alongside
      // the data-level proof above, never in place of it.
      expect(outcome.world.fingerprint).toBe(w1.fingerprint);
      expect(outcome.world.fingerprint).toBe("d0707049");
    });

    it("ord-5534's own concurrent reservation (res-9035) survives the rollback untouched -- the rollback undid only THIS action's own contribution, never the other actor's real write", () => {
      const outcome = runRollback(rollback, w2, w1, { assumeNoConcurrentWriter: true });
      expect(outcome.status).toBe("restored");
      if (outcome.status !== "restored") return;

      const restoredReservations = outcome.world.data.reservations;
      expect(restoredReservations).toHaveLength(2);
      expect(restoredReservations).toContainEqual({
        reservationId: "res-9035",
        orderId: "ord-5534",
        qty: 3,
        createdAt: "2026-09-20T14:03:05Z",
      });
      // And structurally identical to w1's own reservations, not merely
      // "contains res-9035 somewhere among different data":
      expect(restoredReservations).toEqual(w1.data.reservations);
    });

    it("this action's own reservation (res-9042) is NOT present after rollback -- proving the rollback actually undid this write, not a no-op that happened to look restored", () => {
      const outcome = runRollback(rollback, w2, w1, { assumeNoConcurrentWriter: true });
      expect(outcome.status).toBe("restored");
      if (outcome.status !== "restored") return;
      expect(outcome.world.data.reservations.some((r) => r.reservationId === "res-9042")).toBe(false);
    });
  });
});
