import type { Action } from "../../lib/simulate/index.js";
import type { AssumptionKind, Delta, ProjectedEffect, Rollback, World } from "../../lib/contracts/index.js";
import { applyDeltas, buildRollbackSteps } from "../../lib/rollback/index.js";
import type { AppliedReal, DomainAdapter } from "../types.js";
import { growArraySteps } from "../shared/grow.js";

/**
 * Inventory reservation — the concurrency / demo domain. See
 * `.genesis/decisions/0005-domains.md` §Inventory and
 * `m6-domain-cases.md` §2 for the full narrative (INV-1 clean, INV-2 the
 * plan's §B headline TOCTOU moment, INV-3 the `unprojected` case).
 *
 * `available` is tracked as its OWN counter (never derived as
 * `onHand - reserved`) on purpose — see the design doc's own note, carried
 * forward here rather than re-argued: deriving it would couple every
 * OTHER process that touches `onHand` into this domain's reconciliation
 * math, smearing INV-3's "unprojected" lesson across two fields instead
 * of the one field that is actually surprising.
 */
// A TYPE ALIAS to an object literal, not an `interface` — see `calendar/domain.ts`'s identical note
// (following `lib/simulate/__tests__/fixtures.ts`'s own precedent) for why this is load-bearing, not style.
export type StockState = {
  readonly sku: string;
  readonly warehouse: string;
  readonly stock: {
    readonly onHand: number;
    readonly reserved: number;
    readonly available: number;
    readonly damaged?: number;
  };
  readonly reservations: ReadonlyArray<{
    readonly reservationId: string;
    readonly orderId: string;
    readonly qty: number;
    readonly createdAt: string;
  }>;
};

const ASSUMPTIONS: ReadonlyArray<AssumptionKind> = ["no-concurrent-writer", "world-version-unchanged"];

/**
 * `inventory.reserve` ONLY — `inventory.writeOffDamage` is a genuinely
 * DIFFERENT action type, owned by a different real call site (a
 * warehouse-floor process, not the reservation flow), and per the design
 * doc is deliberately never run through THIS domain's `project()`: "it is
 * not itself simulated in these cases." Modeling it here as a second
 * `case` in this same `switch` would silently imply the reservation
 * domain's own shadow-execution logic knows about damage write-offs at
 * all, which is exactly the false confidence INV-3 exists to show this
 * system does NOT have. `domains/inventory/cases.ts` constructs that
 * action's one real `Delta` directly, by hand, as injected interference —
 * never through this adapter.
 *
 * READS `world.data.stock.reserved`/`.available` AT CALL TIME, NOT A
 * CLOSED-OVER STALE VALUE — this is what makes INV-2's TOCTOU case work
 * at all: calling this against `T0` (simulate-time) and against `W1` (the
 * real, already-raced World at execute-time) naturally produces different
 * numbers, the same way a real `UPDATE stock SET reserved = reserved + 5`
 * would be oblivious to whatever the simulator saw earlier.
 */
function computeSteps(action: Action, world: World<StockState>): Delta[] {
  if (action.type !== "reserve") {
    throw new Error(`inventory domain: unknown or unsupported action type "${action.type}"`);
  }
  const params = action.params as {
    readonly orderId: string;
    readonly qty: number;
    readonly reservationId: string;
    readonly createdAt: string;
  };
  const reservedBefore = world.data.stock.reserved;
  const availableBefore = world.data.stock.available;
  const reservationsBefore = world.data.reservations;
  const newReservation = {
    reservationId: params.reservationId,
    orderId: params.orderId,
    qty: params.qty,
    createdAt: params.createdAt,
  };
  // `growArraySteps` for `reservations`, not a single `append` delta —
  // see `domains/shared/grow.ts`'s header for the discovered M3/M5
  // conflict this works around.
  return [
    { path: "stock.reserved", before: reservedBefore, after: reservedBefore + params.qty, kind: "increment" },
    { path: "stock.available", before: availableBefore, after: availableBefore - params.qty, kind: "increment" },
    ...growArraySteps("reservations", reservationsBefore, [...reservationsBefore, newReservation]),
  ];
}

// `deltas: steps` — the RAW pipeline, not netted; see `domains/calendar/domain.ts`'s `project()` for the
// full reasoning (identical here): `checkConsistency` needs the raw `growArraySteps` pair to accept the
// `reservations` append at all; netting for `reconcile()` happens entirely in `scripts/demo-domains.ts`.
function project(action: Action, world: World<StockState>): ProjectedEffect {
  const steps = computeSteps(action, world);
  const final = applyDeltas(world, steps);
  return {
    deltas: steps,
    resultingFingerprint: final.fingerprint,
    assumptions: ASSUMPTIONS,
    producedBy: "shadow-execution",
  };
}

function applyReal(action: Action, world: World<StockState>): AppliedReal<StockState> {
  const steps = computeSteps(action, world);
  return { world: applyDeltas(world, steps), observedDeltas: steps };
}

/**
 * `observedDeltas` here is THIS action's own contribution ONLY (`reserved`
 * /`available`/`reservations` — see `computeSteps` above) — never
 * `stock.damaged`, because this function is never handed a delta this
 * domain didn't itself produce (`domains/inventory/cases.ts` keeps INV-3's
 * injected `writeOffDamage` delta entirely separate — see that file's own
 * comment). `buildRollbackSteps` therefore structurally cannot invert a
 * path this domain has no jurisdiction over, which is exactly
 * `.genesis/decisions/0004-rollback.md`'s Decision 5 answer to "what does
 * rollback restore to" applied here: only this action's own write, never
 * anyone else's.
 */
function proposeRollback(observedDeltas: ReadonlyArray<Delta>, worldBeforeThisWrite: World<StockState>): Rollback {
  const steps = buildRollbackSteps(observedDeltas);
  return {
    kind: "runnable",
    steps,
    projectedRestoration: {
      deltas: steps,
      resultingFingerprint: worldBeforeThisWrite.fingerprint,
      assumptions: ASSUMPTIONS,
      producedBy: "shadow-execution",
    },
  };
}

export const inventoryDomain: DomainAdapter<StockState> = { project, applyReal, proposeRollback };
