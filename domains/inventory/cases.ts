import { makeWorld } from "../../lib/contracts/index.js";
import type { Delta } from "../../lib/contracts/index.js";
import type { DomainCase } from "../types.js";
import { inventoryDomain, type StockState } from "./domain.js";

/**
 * INV-1/INV-2/INV-3 — `m6-domain-cases.md` §2, the plan's §B headline
 * domain. See `.genesis/decisions/0005-domains.md` §Inventory for the
 * full argument behind the two kinds of injected interference used
 * below, and for which of the design doc's quoted fingerprints verified
 * against the real `computeFingerprint` (checked in
 * `domains/__tests__/fingerprints.test.ts`, not merely trusted here).
 */

const t0 = makeWorld<StockState>({
  id: "inv-SKU-77021",
  domain: "inventory",
  version: 12,
  at: "2026-09-18T09:12:00Z",
  data: {
    sku: "SKU-77021",
    warehouse: "WH-EAST-3",
    stock: { onHand: 150, reserved: 37, available: 113 },
    reservations: [{ reservationId: "res-9001", orderId: "ord-5510", qty: 37, createdAt: "2026-09-18T09:12:00Z" }],
  },
});

export const inventoryInv1: DomainCase<StockState> = {
  id: "inv-1-reserve-clean",
  domainName: "inventory",
  title: "INV-1 — reserve 5 units of SKU-77021, nobody else touches this SKU",
  narrative: "Order ord-5533 reserves 5 units of SKU-77021. Nobody else touches this SKU in the window.",
  adapter: inventoryDomain,
  action: {
    domain: "inventory",
    type: "reserve",
    params: { orderId: "ord-5533", qty: 5, reservationId: "res-9042", createdAt: "2026-09-20T14:03:00Z" },
  },
  initialWorld: t0,
  expectedReconciliationStatus: "confirmed",
  expectedRollbackKind: "runnable",
  rollbackPolicy: "unused",
};

/**
 * INV-2 — the plan's §B headline TOCTOU moment. `injectConcurrentWrite`
 * is order `ord-5534`'s OWN real reservation (3 units), landing for real
 * between the moment `simulate()` snapshots `t0` and the moment this
 * action's own `applyReal()` runs — constructed directly, by hand, as the
 * real `World` (`W1`) it actually produces, rather than routed through
 * `inventoryDomain` a second time: `ord-5534`'s reservation is a genuine,
 * ordinary `inventory.reserve` action just like this case's own, and
 * modeling it as anything other than "a second, real write already
 * landed" would understate how ordinary this race is.
 */
const w1 = makeWorld<StockState>({
  id: "inv-SKU-77021",
  domain: "inventory",
  version: 13,
  at: "2026-09-20T14:03:05Z",
  data: {
    sku: "SKU-77021",
    warehouse: "WH-EAST-3",
    stock: { onHand: 150, reserved: 40, available: 110 },
    reservations: [
      { reservationId: "res-9001", orderId: "ord-5510", qty: 37, createdAt: "2026-09-18T09:12:00Z" },
      { reservationId: "res-9035", orderId: "ord-5534", qty: 3, createdAt: "2026-09-20T14:03:05Z" },
    ],
  },
});

export const inventoryInv2: DomainCase<StockState> = {
  id: "inv-2-reserve-toctou",
  domainName: "inventory",
  title: "INV-2 — the demo moment: same action, injected concurrent writer",
  narrative:
    "Same order, same action — ord-5533 reserving 5 units of SKU-77021 — but between simulate() and execute, " +
    "order ord-5534 commits its own real reservation (3 units) against the same SKU first. A genuine TOCTOU " +
    "race on a shared resource: both writes are real, only their order relative to the simulation is adversarial.",
  adapter: inventoryDomain,
  action: {
    domain: "inventory",
    type: "reserve",
    params: { orderId: "ord-5533", qty: 5, reservationId: "res-9042", createdAt: "2026-09-20T14:03:07Z" },
  },
  initialWorld: t0,
  injectConcurrentWrite: () => w1,
  expectedReconciliationStatus: "drifted",
  expectedRollbackKind: "runnable",
  // "execute" + "assume-no-concurrent-writer": the race already happened
  // (baked into observedDeltas as the W1 -> W2 diff) BEFORE this action's
  // own write. The window this flag actually asserts something about is
  // the DIFFERENT one between this action's write and its rollback
  // running — and in this synthetic demo nothing touches inv-SKU-77021
  // in that second window, so the strong, whole-World claim is honestly
  // available and is exactly what proves the plan's §B fingerprint
  // equality on screen. See ADR 0005 for why these are not the same
  // window and why asserting the flag here does not contradict INV-2
  // being "the concurrency case."
  rollbackPolicy: "execute",
  rollbackHonestyCheck: "assume-no-concurrent-writer",
};

/**
 * INV-3 — the `unprojected` case. `SKU-88104` is a DIFFERENT SKU from
 * INV-1/INV-2 on purpose (a fresh aggregate, not reused, so this case's
 * concurrent write can never be confused with INV-2's). `stock.damaged`
 * starts at `0`, present from the start — see the design doc's own note
 * that INV-3 is a numeric field CHANGING (`0 -> 4`), not a field
 * APPEARING out of nowhere, which is what makes `classifyKind`-style
 * ambiguity unnecessary here: this domain never infers `kind` from a
 * before/after pair, every `Delta` in this file (like every other domain
 * in this milestone) is authored directly, by the code that caused the
 * change.
 */
const inv3World = makeWorld<StockState>({
  id: "inv-SKU-88104",
  domain: "inventory",
  version: 20,
  at: "2026-09-19T11:00:00Z",
  data: {
    sku: "SKU-88104",
    warehouse: "WH-EAST-3",
    stock: { onHand: 200, reserved: 60, available: 140, damaged: 0 },
    reservations: [{ reservationId: "res-9500", orderId: "ord-6010", qty: 60, createdAt: "2026-09-19T11:00:00Z" }],
  },
});

/**
 * `inventory.writeOffDamage { qty: 4 }` — a genuinely different action
 * type, owned by a different real call site (the warehouse floor, not
 * the reservation flow), landing on the SAME `World.id` concurrently with
 * this case's own `inventory.reserve`. Represented as the ONE real
 * `Delta` it produces rather than as a second `DomainAdapter`: this
 * milestone's reservation domain has no `project()` logic for damage
 * write-offs at all (deliberately — see `domain.ts`'s header), so there
 * is no adapter to "run" here, only the one fact that a different, real
 * writer touched a path this domain does not own.
 */
export const inv3UnrelatedConcurrentDelta: Delta = { path: "stock.damaged", before: 0, after: 4, kind: "increment" };

export const inventoryInv3: DomainCase<StockState> = {
  id: "inv-3-reserve-unprojected",
  domainName: "inventory",
  title: "INV-3 — a routine reservation, while a different SKU's damage write-off lands concurrently",
  narrative:
    "A second, unrelated business process (a warehouse-floor write-off, not a reservation) marks 4 units of " +
    "the same SKU's stock record as damaged while a routine reservation is mid-flight against the same record. " +
    "The two processes share an aggregate but not a call path.",
  adapter: inventoryDomain,
  action: {
    domain: "inventory",
    type: "reserve",
    params: { orderId: "ord-6044", qty: 10, reservationId: "res-9611", createdAt: "2026-09-20T14:20:00Z" },
  },
  initialWorld: inv3World,
  injectUnrelatedConcurrentDelta: inv3UnrelatedConcurrentDelta,
  expectedReconciliationStatus: "unprojected",
  expectedRollbackKind: "runnable",
  // "propose-only": per the design doc's own words, "whether this
  // rollback ever runs is a trust-gate decision this domain does not
  // make" — this demo's wiring deliberately does not auto-execute it
  // either, and says so on screen rather than silently deciding for a
  // gate this milestone was told never to own.
  rollbackPolicy: "propose-only",
};

export const inventoryCases: ReadonlyArray<DomainCase<StockState>> = [inventoryInv1, inventoryInv2, inventoryInv3];
