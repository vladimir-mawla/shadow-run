import { describe, expect, it } from "vitest";
import { makeWorld, type Delta, type World } from "../../lib/contracts/index.js";
import { simulate, type Action, type SimulationAdapter } from "../../lib/simulate/index.js";
import { applyDeltas } from "../../lib/rollback/index.js";
import {
  DEFAULT_TRUST_THRESHOLD,
  makeInitialTrust,
  reconcile,
  requiresPreValidatedRollback,
  updateTrust,
} from "../../lib/reconcile/index.js";
import type { Reconciliation } from "../../lib/contracts/reconciliation.js";

/**
 * M7 CASE 2 — FULL PIN, RUNNABLE TODAY. Pins PLAN.md's M7 success
 * criterion (2): "a domain whose `project()` is deliberately wrong
 * (always predicts a no-op), asserted to be caught by `SimulatorTrust`'s
 * counter within a documented, honestly-stated number of executions."
 *
 * WHY THIS DOES NOT NEED M6 (`domains/**`, not on this branch): the
 * "wrong domain" is not a real inventory/calendar/notification/infra
 * adapter — it is a fake `SimulationAdapter<StockState>` (below) that
 * satisfies M3's real, frozen `lib/simulate/adapter.ts` interface and
 * nothing more. `simulate()`, `reconcile()`, and every `lib/reconcile/
 * trust.ts` function only ever see `Action`/`World`/`Delta[]`/
 * `Reconciliation`/`SimulatorTrust` values — never a domain object — so a
 * hand-built adapter is a completely legitimate, real exercise of all of
 * them, not a stand-in for one. Every function this file calls
 * (`simulate`, `reconcile`, `makeInitialTrust`, `updateTrust`,
 * `requiresPreValidatedRollback`, `DEFAULT_TRUST_THRESHOLD`) is real,
 * merged code read directly from `lib/**` before writing this file — none
 * of it is asserted from the design doc's description.
 *
 * WHY EVERY CALL BELOW ALWAYS CLASSIFIES AS "unprojected", NEVER
 * "confirmed" NOR "drifted" — decidable by reading `reconcile.ts`
 * directly, not assumed: `alwaysNoOpAdapter.project` always returns
 * `deltas: []`. `reconcile()`'s pass 1 only ever fires for a `path` that
 * has a PREDICTED delta (a real mismatch, or a "vanished prediction");
 * with `predicted = []`, `predictedByPath` is empty, so pass 1 never
 * matches anything for any `path`, no matter what the real, non-trivial
 * `observed` delta is. Pass 2 then finds every real `observed` delta
 * (there is always at least one — this fixture's "real mutation" is a
 * genuine `stock.reserved`-shaped increment each time, never a no-op
 * itself) has no predicted counterpart at all, and returns
 * `"unprojected"`. This is mechanical and total: it is true of every
 * call, not just the ones this file happens to run.
 *
 * `applyDeltas` (M5, real, `lib/rollback/**`) is used ONLY as a
 * convenient, real generic interpreter to advance the fixture `World`
 * realistically between iterations (exactly how
 * `lib/rollback/__tests__/run-rollback.test.ts` already uses it to build
 * a "real post-action World" fixture) — it is not what is being tested
 * here, and this file draws no conclusion about `lib/rollback/**` from
 * it.
 *
 * THE LAG, NAMED EXACTLY, AS INSTRUCTED: `DEFAULT_TRUST_THRESHOLD`
 * (`lib/reconcile/trust.ts`, read directly rather than hardcoded — today
 * its value is 3, and every assertion below is built FROM the imported
 * constant, not a literal `3`, so this file moves automatically if that
 * constant ever changes) real executions of this wrongly-simulated action
 * ship — with their real consequences already landed in the world — before
 * `requiresPreValidatedRollback` returns anything other than `false`. If
 * this domain's actions are consequential (an irreversible send, a real
 * reservation), those executions are not hypothetical exposure: they are
 * real, uncaught, wrongly-simulated writes that already happened by the
 * time anything downstream changes.
 *
 * THE HARDER, LESS COMFORTABLE TRUTH, NAMED RATHER THAN BURIED: this
 * always-wrong domain is the BEST CASE for this detector, not a worst
 * case — precisely because it can never produce a "confirmed"
 * reconciliation (predicted is always `[]`; a non-empty observed effect
 * can never match nothing), the counter only ever climbs, and once it
 * crosses the threshold it can never legitimately reset. The number this
 * suite must own honestly is not "N executions, always" but "N
 * executions, if and only if the domain is consistently wrong." A domain
 * that occasionally reconfirms — even by accident — resets the counter to
 * `0` (see `updateTrust`'s reset-on-success arithmetic, `lib/reconcile/
 * trust.ts`) and restarts the same N-execution grace period; a domain that
 * alternates wrong/right on a period never trips the gate at all
 * (`simulator-trust.ts`'s own header already names this accepted cost —
 * this file reuses that fact rather than re-arguing it, in the dedicated
 * test below).
 *
 * DESIGN-DOC CROSS-CHECK: `m7-failure-suite.md`'s Case 2 section describes
 * exactly this mechanism and labels it "full pin, runnable today" — the
 * one case in that document that was NOT stale once M3/M5 actually landed
 * (unlike Case 3's `RollbackFailed` assumption, corrected in
 * `case-3-partial-rollback-failure.test.ts`'s own header). Confirmed here
 * by actually running it, not merely re-asserted from the doc.
 */

type StockState = { readonly reserved: number };

function stockWorld(reserved: number, version = 1): World<StockState> {
  return makeWorld<StockState>({
    id: "sku-case2",
    domain: "inventory",
    version,
    at: "2026-09-20T00:00:00.000Z",
    data: { reserved },
  });
}

function reserveAction(qty: number): Action {
  return { domain: "inventory", type: "reserve", params: { qty } };
}

/**
 * The deliberately wrong `project()` — satisfies `SimulationAdapter
 * <StockState>` (`lib/simulate/adapter.ts`, real, frozen) and nothing
 * more. Always predicts a no-op: `deltas: []`, `resultingFingerprint`
 * copied unchanged from the input `World.fingerprint`, regardless of
 * `action`. This is INTERNALLY CONSISTENT (checkConsistency, `lib/
 * simulate/consistency.ts`, would find it self-consistent: applying zero
 * deltas to `data` leaves it unchanged, and the unchanged fingerprint is
 * exactly the claim made) — it is a well-formed, honest-looking
 * projection that is simply wrong about the world, which is the whole
 * point: this case is about a projection nothing in `simulate()`'s own
 * fail-closed gates has any reason to reject, only `reconcile()` (against
 * REAL, observed execution) can catch.
 */
const alwaysNoOpAdapter: SimulationAdapter<StockState> = {
  project(_action, world) {
    return {
      deltas: [],
      resultingFingerprint: world.fingerprint,
      assumptions: [],
      producedBy: "shadow-execution",
    };
  },
};

/** One iteration of "simulate the wrong way, then execute for real": returns the observed Delta (the genuine mutation) and the advanced real World. */
function realExecutionStep(before: World<StockState>, qty: number): { readonly observed: Delta; readonly after: World<StockState> } {
  const observed: Delta = { path: "reserved", before: before.data.reserved, after: before.data.reserved + qty, kind: "increment" };
  return { observed, after: applyDeltas(before, [observed]) };
}

describe("Case 2 — full pin: an always-wrong project(), driven through the real simulate()/reconcile()/SimulatorTrust pipeline", () => {
  it("simulate() accepts the always-no-op projection cleanly (ok:true, deltas:[]) — it is malformed/inconsistent-effect gates have no basis to reject a projection that is merely wrong, not self-contradictory", () => {
    const world = stockWorld(100);
    const result = simulate(reserveAction(5), world, alwaysNoOpAdapter);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.effect.deltas).toEqual([]);
      expect(result.effect.resultingFingerprint).toBe(world.fingerprint);
    }
  });

  it('reconcile() classifies EVERY real execution as "unprojected" for this domain — never "confirmed", never "drifted" — for DEFAULT_TRUST_THRESHOLD + 2 consecutive real executions', () => {
    let world = stockWorld(100);
    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD + 2; i++) {
      const simResult = simulate(reserveAction(5), world, alwaysNoOpAdapter);
      if (!simResult.ok) throw new Error("unreachable: alwaysNoOpAdapter always produces a valid SimulationResult");

      const { observed, after } = realExecutionStep(world, 5);
      const reconciliation = reconcile(simResult.effect.deltas, [observed]);
      expect(reconciliation.status).toBe("unprojected");

      world = after;
    }
  });

  it(`names the lag exactly: N-1 (${DEFAULT_TRUST_THRESHOLD - 1}) real, wrongly-simulated executions do NOT flip requiresPreValidatedRollback; N (${DEFAULT_TRUST_THRESHOLD}, DEFAULT_TRUST_THRESHOLD) does — mirroring trust.test.ts's own pattern, driven here through this specific always-wrong domain's real reconciliations rather than hand-built ones`, () => {
    let world = stockWorld(200);
    let trust = makeInitialTrust("inventory.reserve");

    for (let i = 1; i <= DEFAULT_TRUST_THRESHOLD; i++) {
      const simResult = simulate(reserveAction(5), world, alwaysNoOpAdapter);
      if (!simResult.ok) throw new Error("unreachable");

      const { observed, after } = realExecutionStep(world, 5);
      const reconciliation = reconcile(simResult.effect.deltas, [observed]);
      trust = updateTrust(trust, reconciliation);
      world = after;

      expect(trust.consecutiveNonConfirmed).toBe(i);
      if (i < DEFAULT_TRUST_THRESHOLD) {
        // The lag: this execution's wrong prediction already shipped for
        // real (world.data.reserved already moved), and the gate has not
        // reacted yet.
        expect(requiresPreValidatedRollback(trust)).toBe(false);
      } else {
        expect(requiresPreValidatedRollback(trust)).toBe(true);
      }
    }
  });

  it("the favorable edge of always-wrong: once flipped, the gate for this domain never resets, because an always-empty prediction can never produce a confirmed reconciliation to reset it", () => {
    let world = stockWorld(300);
    let trust = makeInitialTrust("inventory.reserve");

    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD + 6; i++) {
      const simResult = simulate(reserveAction(3), world, alwaysNoOpAdapter);
      if (!simResult.ok) throw new Error("unreachable");

      const { observed, after } = realExecutionStep(world, 3);
      trust = updateTrust(trust, reconcile(simResult.effect.deltas, [observed]));
      world = after;

      if (i >= DEFAULT_TRUST_THRESHOLD - 1) {
        expect(requiresPreValidatedRollback(trust)).toBe(true);
      }
    }
    expect(trust.consecutiveNonConfirmed).toBe(DEFAULT_TRUST_THRESHOLD + 6);
  });

  it("HONEST CONTRAST, named rather than buried: a domain that reconfirms even once resets the counter and restarts the full N-execution grace period — proving the always-wrong domain above is the detector's BEST case, not a representative one", () => {
    // alwaysNoOpAdapter structurally cannot ever produce a "confirmed"
    // reconciliation (see file header) — so this contrast is driven with
    // a hand-built Reconciliation value, exactly like trust.test.ts's own
    // fixtures, through the same real updateTrust/requiresPreValidatedRollback.
    // This is not a claim about alwaysNoOpAdapter; it is the necessary
    // "what if it weren't always wrong" comparison this case's own
    // honesty requirement asks for.
    const DRIFTED: Reconciliation = {
      status: "drifted",
      expected: { path: "reserved", before: 1, after: 2, kind: "set" },
      actual: { path: "reserved", before: 1, after: 3, kind: "set" },
    };
    const CONFIRMED: Reconciliation = { status: "confirmed", matched: [] };

    let trust = makeInitialTrust("flaky.reserve");
    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD - 1; i++) trust = updateTrust(trust, DRIFTED);
    expect(requiresPreValidatedRollback(trust)).toBe(false);

    trust = updateTrust(trust, CONFIRMED); // one accidental reconfirmation
    expect(trust.consecutiveNonConfirmed).toBe(0); // full reset — not N-2

    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD - 1; i++) {
      trust = updateTrust(trust, DRIFTED);
      expect(requiresPreValidatedRollback(trust)).toBe(false); // must climb a FULL new run of N
    }
  });
});
