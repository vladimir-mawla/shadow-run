"use client";

import { useEffect, useState, type JSX } from "react";
import { simulate, type Action } from "../lib/simulate/index";
import { reconcile, updateTrust, makeInitialTrust, DEFAULT_TRUST_THRESHOLD } from "../lib/reconcile/index";
import { runRollback, verifyStepsAreHonestInversion, type RollbackOutcome } from "../lib/rollback/index";
import type {
  AssumptionKind,
  Delta,
  ProjectedEffect,
  Reconciliation,
  Rollback,
  SimulatorTrust,
  World,
} from "../lib/contracts/index";
import { inventoryDomain, inventoryInv1, netDeltas, type StockState } from "../domains/index";
import { DeltaRow } from "./DeltaRow";
import { StatusChip } from "./StatusChip";
import { RestorationVerdict } from "./RestorationVerdict";

/**
 * THE PAGE-LEVEL PIPELINE (m8-demo-design.md §4/§5) — the piece this
 * milestone's first, partial pass deliberately left out because M6's
 * inventory domain did not exist yet. It now does (`domains/inventory/**`),
 * so this component wires the presentational pieces already built
 * (`DeltaRow`, `FingerprintPair`, `StatusChip`, `RestorationVerdict` —
 * reused verbatim, not rebuilt) to the REAL engine calls: `simulate()`,
 * `reconcile()`, `runRollback()`, and `inventoryDomain.applyReal()` /
 * `.proposeRollback()`. Nothing here computes a `Delta`, a `Reconciliation`,
 * or a `Rollback` by hand — every one of those values is the real return of
 * a real call, exactly the "render, don't produce" line the first pass's
 * components already drew for themselves.
 *
 * "RUN 1" AND "RUN 2" ARE ONE FLOW, NOT TWO CODE PATHS (§4's own point):
 * there is exactly one Simulate button and one Execute button, both always
 * calling the same real functions the same way. The only thing that
 * changes what a viewer sees is whether "Inject concurrent change" was
 * clicked in between — a real fact about what happened to the live
 * `World`, never a flag this component branches on. `handleExecute` below
 * branches on `reconciliation.status`, the real output of a real
 * `reconcile()` call, never on "was I raced."
 *
 * THE `assumeNoConcurrentWriter` QUESTION, ANSWERED FOR THIS CALL SITE —
 * AND WHY THAT ANSWER IS NOT THE ONLY THING THIS FILE RELIES ON (ADR 0004
 * Decision 7's forward note; `domains/inventory/cases.ts`'s own comment on
 * INV-2 answers this for `scripts/demo-domains.ts`'s synchronous
 * `runCase()`, but that argument does not automatically transfer to a
 * React event handler, and an earlier version of this file leaned on a
 * single structural argument to make it transfer anyway — exactly the
 * shape of proof this project's own history (five bypasses on one guard at
 * M2, a sixth on the import allowlist since) has already shown fails):
 *
 * `runCase()` is one synchronous JS function call — nothing can write to
 * `inv-SKU-77021` between its own `applyReal()` and its own `runRollback()`
 * because JS is single-threaded and that whole stretch never yields (no
 * `await`, no `setTimeout`, no microtask). A React click handler is NOT
 * automatically the same guarantee: if this component instead deferred
 * `runRollback` into a `useEffect` or behind a `setTimeout` (e.g. to get
 * the design's own "half-second minimum visible duration" before revealing
 * the verdict), the browser's event loop WOULD get a chance to process a
 * queued click on "Inject" — which this design deliberately keeps
 * clickable — in exactly the window `assumeNoConcurrentWriter` claims is
 * empty.
 *
 * So `handleExecute` below keeps the entire
 * `applyReal → netDeltas → reconcile → proposeRollback → runRollback`
 * sequence in ONE synchronous call, with zero `await`/`setTimeout`/promise
 * boundary anywhere inside it, and calls `setState` only once everything —
 * including `runRollback`'s own result — has already been computed. This
 * remains true today, and it is WHY `assumeNoConcurrentWriter: true` is
 * honest to pass here: nothing else can write to this `World.id` in the
 * window the flag talks about, for the same run-to-completion reason
 * `runCase()` gets it for free.
 *
 * BUT THIS FILE DOES NOT REST THE WHOLE CLAIM ON THAT ONE ARGUMENT holding
 * forever. `handleExecute` also calls `verifyStepsAreHonestInversion`
 * (`lib/rollback/run-rollback.ts`) — ADR 0004 Decision 7's OTHER honesty
 * check, which is `deepEqual`-over-data, never looks at `World` state at
 * all, and is valid REGARDLESS of whether a concurrent writer exists or
 * whether the atomicity argument above still holds. The two checks buy
 * different things and fail differently, on purpose:
 *
 *   - `assumeNoConcurrentWriter: true` buys the STRONGER claim —
 *     `fullWorldRestorationVerified`, the whole-`World` `deepEqual` this
 *     demo's headline fingerprint-equality moment depends on. It is
 *     honest only as long as the synchronous-call-stack argument above
 *     holds. If a future edit ever moved `runRollback` behind a real
 *     yield point, this flag would start asserting something no longer
 *     true.
 *   - `verifyStepsAreHonestInversion` buys a NARROWER, ALWAYS-true claim —
 *     that `rollback.steps` really is `buildRollbackSteps(observedDeltas)`,
 *     i.e. the recorded plan is not fabricated or miscalculated — and
 *     this claim's validity does NOT depend on the atomicity argument at
 *     all, so it keeps working even if that argument is silently broken
 *     later.
 *
 * The point of calling both is exactly ADR 0004 Decision 7's own framing:
 * if the atomicity argument above ever stops holding (a refactor, not a
 * concurrent write this demo can produce today), the STRONGER claim
 * degrades or goes wrong — `runRollback`'s own internal cheap-consistency
 * check and its `dataMatchesExactly` check both already fail closed
 * toward `"dishonest"` rather than a false `"restored"` (see
 * `run-rollback.ts`'s own header) — while `verifyStepsAreHonestInversion`
 * keeps reporting its own, narrower, still-true fact regardless. Two
 * checks that fail differently, rather than one clever argument a single
 * refactor can silently void.
 *
 * WHY `handleExecute` CALLS `reconcile()` TWICE — A REAL FINDING, NOT A
 * WORKAROUND (surfaced by M7's own TOCTOU test against this merged domain,
 * confirmed independently against `npm run demo:domains`'s own INV-2
 * output before this file was changed to account for it): feeding the
 * whole, three-path netted pipeline into ONE `reconcile()` call reports
 * `drifted` at `"reservations"`, never at `"stock.reserved"` — NOT a bug,
 * exactly what `reconcile.ts`'s own header documents (ascending-
 * lexicographic-path priority among several real drifted paths;
 * `"reservations"` sorts before `"stock.available"`/`"stock.reserved"` and
 * genuinely did drift too). That means `sim-plan.md` §B's own headline
 * sentence — "stock.reserved: predicted 42, observed 45" — is NOT what the
 * real, frozen `reconcile()` returns for the whole-pipeline call, and this
 * component must not print that sentence as if it were, the same
 * discipline `delta-render-rules.ts` already applies to a synthesized
 * `actual`: never show a viewer a fact the engine did not actually report
 * for the call being described.
 *
 * `reconcile.ts`'s own header names the fix directly: "a caller that needs
 * to see every drifted/unprojected path... must call `reconcile()`
 * per-path itself (e.g. by slicing the two `Delta[]`s)." So
 * `stockReservedReconciliation` below is the SAME real `reconcile()`,
 * called a SECOND time, with both sides sliced to `path ===
 * "stock.reserved"` — not a fabricated number, not the first call's
 * result relabeled. Both results are kept and both are rendered (see the
 * JSX below): the whole-pipeline reconciliation as the system's actual,
 * primary answer for this call, and the sliced one alongside it, clearly
 * labeled as a second, separate `reconcile()` call — never presented as
 * what the first call returned.
 */

const ACTION_TYPE = "inventory.reserve";

/**
 * Builds the real `Action` "Inject concurrent change" hands to
 * `inventoryDomain.applyReal()`. The FIRST click reuses the exact
 * orderId/reservationId/qty/timestamp `domains/inventory/cases.ts`'s own
 * INV-2 fixture uses to produce its documented `W1` (`fingerprint
 * d0707049`), so this component's own first-click numbers match what
 * `docs/WALKTHROUGH.md` and `m8-demo-design.md` quote exactly rather than
 * drifting from them by coincidence. Every later click is a genuinely NEW
 * order (a fresh `orderId`/`reservationId`), not a bigger `qty` on the same
 * one — m8-demo-design.md §4's own self-evidence-test framing is explicit
 * that repeat clicks should read as separate real orders each adding their
 * own +3, which is also what `domains/shared/grow.ts`'s `growArraySteps`
 * needs to append a genuinely new `reservations` entry each time rather
 * than colliding on an id already used.
 */
function buildInjectAction(clickNumber: number): Action {
  if (clickNumber === 1) {
    return {
      domain: "inventory",
      type: "reserve",
      params: { orderId: "ord-5534", qty: 3, reservationId: "res-9035", createdAt: "2026-09-20T14:03:05Z" },
    };
  }
  return {
    domain: "inventory",
    type: "reserve",
    params: {
      orderId: `ord-5534-${clickNumber}`,
      qty: 3,
      reservationId: `res-injected-${clickNumber}`,
      createdAt: `2026-09-20T14:03:${String(4 + clickNumber).padStart(2, "0")}Z`,
    },
  };
}

interface InjectLogEntry {
  readonly orderId: string;
  readonly reservationId: string;
  readonly qty: number;
  readonly worldFingerprintAfter: string;
}

interface RunResult {
  readonly worldBeforeThisWrite: World<StockState>;
  readonly observedDeltas: ReadonlyArray<Delta>;
  readonly reconciliation: Reconciliation;
  /**
   * `reconcile()` CALLED AGAIN, on the SAME two real delta arrays, sliced
   * to `path === "stock.reserved"` — see this file's header for why this
   * exists and is not a shortcut past `reconciliation` above. Always
   * computed; only rendered when `reconciliation.status !== "confirmed"`
   * (when confirmed, every predicted delta matched every observed one, so
   * this slice is necessarily confirmed too — showing it would be
   * redundant, not additionally honest).
   */
  readonly stockReservedReconciliation: Reconciliation;
  readonly rollback: Rollback;
  /**
   * `verifyStepsAreHonestInversion(observedDeltas, rollback.steps)` — ADR
   * 0004 Decision 7's always-valid check, computed whenever `rollback` is
   * `runnable`, regardless of whether it actually got executed. `null`
   * only for `rollback.kind === "unavailable"` (nothing to check). See
   * this file's header for why this is called alongside, never instead
   * of, `assumeNoConcurrentWriter`.
   */
  readonly honestInversionVerified: boolean | null;
  readonly rollbackOutcome: RollbackOutcome<StockState> | null;
  readonly trustBefore: SimulatorTrust;
  readonly trustAfter: SimulatorTrust;
}

function findReservation(world: World<StockState>, reservationId: string) {
  return world.data.reservations.find((r) => r.reservationId === reservationId) ?? null;
}

/**
 * Split out as its own function component (rather than an inline
 * expression in `InventoryDemo`'s JSX) so `outcome.status === "restored"`
 * narrows `outcome` for the REST OF THIS FUNCTION, including inside the
 * `injectLog.map` closure below — ordinary TypeScript control-flow
 * narrowing on a parameter/local works across nested closures within the
 * SAME function body; it does not extend into a nested arrow function
 * from an outer scope's property-access check (`result.rollbackOutcome
 * .status === "restored"` checked in the caller does not, by itself, let
 * `result.rollbackOutcome.world` be read safely inside a `.map()`
 * callback one scope deeper) — this component exists to give that check
 * its own scope, not for any rendering reason.
 */
function RollbackVerdictSection({
  outcome,
  worldBeforeThisWrite,
  injectLog,
}: {
  readonly outcome: RollbackOutcome<StockState>;
  readonly worldBeforeThisWrite: World<StockState>;
  readonly injectLog: ReadonlyArray<InjectLogEntry>;
}): JSX.Element {
  if (outcome.status !== "restored") {
    return <StatusChip tone="negative" label={`Rollback did not restore: ${outcome.status}`} />;
  }
  const restoredWorld = outcome.world;
  return (
    <>
      <RestorationVerdict
        restoredData={restoredWorld.data}
        preActionData={worldBeforeThisWrite.data}
        beforeFingerprint={worldBeforeThisWrite.fingerprint}
        afterFingerprint={restoredWorld.fingerprint}
      />
      {injectLog.map((entry) => {
        const stillThere = findReservation(restoredWorld, entry.reservationId);
        return (
          <p key={entry.reservationId} className="untouched-line">
            {entry.orderId}&rsquo;s reservation (<code className="mono">{entry.reservationId}</code>) —{" "}
            {stillThere ? <>untouched, qty {stillThere.qty}</> : <strong>MISSING after rollback — this would be a bug</strong>}
          </p>
        );
      })}
    </>
  );
}

/** `AssumptionKind` chips for a `ProjectedEffect` — struck-through and relabelled "assumed — violated" for
 * exactly the one assumption this demo's own injection control can violate ("no-concurrent-writer"), never
 * for "world-version-unchanged" — checking THAT one honestly would mean comparing `World.version` across
 * the race, which this pass does not build (named in the report as a real, scoped gap, not silently skipped). */
function AssumptionChips({
  assumptions,
  noConcurrentWriterViolated,
}: {
  readonly assumptions: ReadonlyArray<AssumptionKind>;
  readonly noConcurrentWriterViolated: boolean;
}): JSX.Element {
  return (
    <div className="assumption-chips">
      {assumptions.map((assumption) => {
        const violated = assumption === "no-concurrent-writer" && noConcurrentWriterViolated;
        return (
          <StatusChip
            key={assumption}
            tone={violated ? "negative" : "neutral"}
            label={violated ? `${assumption} — assumed, violated` : assumption}
          />
        );
      })}
    </div>
  );
}

export function InventoryDemo(): JSX.Element {
  const [world, setWorld] = useState<World<StockState>>(inventoryInv1.initialWorld);
  const [phase, setPhase] = useState<"idle" | "simulated" | "executed">("idle");
  const [projected, setProjected] = useState<ProjectedEffect | null>(null);
  const [injectLog, setInjectLog] = useState<ReadonlyArray<InjectLogEntry>>([]);
  const [trust, setTrust] = useState<SimulatorTrust>(() => makeInitialTrust(ACTION_TYPE));
  const [result, setResult] = useState<RunResult | null>(null);
  const [revealed, setRevealed] = useState(false);

  // The design's own "deliberate half-second minimum" (m8-demo-design.md
  // §5) — purely a reveal delay for legibility. See this file's header
  // comment: everything this gates has ALREADY been computed, synchronously,
  // inside handleExecute, before `result` was ever set.
  useEffect(() => {
    if (result === null) return;
    setRevealed(false);
    const timer = setTimeout(() => setRevealed(true), 500);
    return () => clearTimeout(timer);
  }, [result]);

  function handleReset(): void {
    setWorld(inventoryInv1.initialWorld);
    setPhase("idle");
    setProjected(null);
    setInjectLog([]);
    setTrust(makeInitialTrust(ACTION_TYPE));
    setResult(null);
    setRevealed(false);
  }

  function handleSimulate(): void {
    const simResult = simulate(inventoryInv1.action, world, { project: inventoryDomain.project });
    if (!simResult.ok) {
      // Not reachable for this action/world pairing — both real, frozen
      // domains/inventory/cases.ts fixtures — surfaced loudly rather than
      // silently swallowed if it somehow ever were.
      throw new Error(`simulate() failed: ${JSON.stringify(simResult.failure)}`);
    }
    setProjected(simResult.effect);
    setPhase("simulated");
  }

  function handleInject(): void {
    const clickNumber = injectLog.length + 1;
    const injectAction = buildInjectAction(clickNumber);
    // THE REAL RACE: a second, real call into inventoryDomain's own
    // applyReal(), against whatever World is live RIGHT NOW — never a
    // hand-set setWorld({...}) standing in for one. See file header.
    const applied = inventoryDomain.applyReal(injectAction, world);
    const params = injectAction.params as { readonly orderId: string; readonly reservationId: string; readonly qty: number };
    setWorld(applied.world);
    setInjectLog((log) => [
      ...log,
      { orderId: params.orderId, reservationId: params.reservationId, qty: params.qty, worldFingerprintAfter: applied.world.fingerprint },
    ]);
  }

  function handleExecute(): void {
    if (projected === null) return;

    // See file header: from here to the optional runRollback() call below
    // is ONE synchronous call, no yield points, on purpose.
    const worldBeforeThisWrite = world;
    const { world: worldAfterOwnWrite, observedDeltas } = inventoryDomain.applyReal(inventoryInv1.action, worldBeforeThisWrite);

    const projectedForReconciliation = netDeltas(projected.deltas);
    const observedForReconciliation = netDeltas(observedDeltas);
    const reconciliation = reconcile(projectedForReconciliation, observedForReconciliation);
    // See file header ("WHY handleExecute CALLS reconcile() TWICE"): the
    // real, documented way (reconcile.ts's own header) to see a second
    // fact the whole-pipeline call's frozen Reconciliation shape has no
    // room to carry alongside "reservations" in one call.
    const stockReservedReconciliation = reconcile(
      projectedForReconciliation.filter((delta) => delta.path === "stock.reserved"),
      observedForReconciliation.filter((delta) => delta.path === "stock.reserved"),
    );
    const rollback = inventoryDomain.proposeRollback(observedDeltas, worldBeforeThisWrite);
    // ADR 0004 Decision 7's always-valid check — computed whenever there
    // are steps to check, independent of whether the rollback below
    // actually runs, and independent of the atomicity argument the
    // assumeNoConcurrentWriter call depends on. See file header.
    const honestInversionVerified =
      rollback.kind === "runnable" ? verifyStepsAreHonestInversion(observedDeltas, rollback.steps) : null;

    let rollbackOutcome: RollbackOutcome<StockState> | null = null;
    let finalWorld = worldAfterOwnWrite;
    if (reconciliation.status !== "confirmed") {
      // domains/inventory/cases.ts's own INV-2 policy, run for real here:
      // "execute" + "assume-no-concurrent-writer" — honest for THIS call
      // site for the reason this file's header argues at length, and
      // backed by honestInversionVerified above as the second, always-
      // valid check per ADR 0004 Decision 7 rather than resting on one.
      rollbackOutcome = runRollback(rollback, worldAfterOwnWrite, worldBeforeThisWrite, { assumeNoConcurrentWriter: true });
      if (rollbackOutcome.status === "restored") {
        finalWorld = rollbackOutcome.world;
      }
    }

    const trustAfter = updateTrust(trust, reconciliation);

    setWorld(finalWorld);
    setTrust(trustAfter);
    setResult({
      worldBeforeThisWrite,
      observedDeltas,
      reconciliation,
      stockReservedReconciliation,
      rollback,
      honestInversionVerified,
      rollbackOutcome,
      trustBefore: trust,
      trustAfter,
    });
    setPhase("executed");
  }

  return (
    <section className="inventory-demo">
      <div className="world-card">
        <div className="world-card__heading">
          <span className="mono">{world.data.sku}</span>
          <span className="world-card__warehouse">{world.data.warehouse}</span>
        </div>
        <div className="world-card__stats">
          <div>
            <span className="world-card__stat-label">reserved</span>
            <span className="mono world-card__stat-value">{world.data.stock.reserved}</span>
          </div>
          <div>
            <span className="world-card__stat-label">available</span>
            <span className="mono world-card__stat-value">{world.data.stock.available}</span>
          </div>
          <div>
            <span className="world-card__stat-label">reservations</span>
            <span className="mono world-card__stat-value">{world.data.reservations.length}</span>
          </div>
        </div>
        <div className="mono world-card__fingerprint">fingerprint {world.fingerprint}</div>
      </div>

      <div className="demo-actions">
        <button type="button" onClick={handleReset}>
          Reset to T0
        </button>
        <button type="button" onClick={handleSimulate} disabled={phase !== "idle"}>
          Simulate
        </button>
        <button type="button" onClick={handleInject} disabled={phase !== "simulated"}>
          Inject concurrent change{injectLog.length > 0 ? ` (${injectLog.length})` : ""}
        </button>
        <button type="button" onClick={handleExecute} disabled={phase !== "simulated"}>
          Execute
        </button>
      </div>
      {phase === "idle" && <p className="demo-hint">Execute — simulate first.</p>}

      {injectLog.length > 0 && (
        <div className="inject-log">
          <span className="inject-log__label">real concurrent writes landed</span>
          <ul>
            {injectLog.map((entry) => (
              <li key={entry.reservationId} className="mono">
                + {entry.orderId} reserved {entry.qty} units (real write, landed just now) → fingerprint{" "}
                {entry.worldFingerprintAfter}
              </li>
            ))}
          </ul>
        </div>
      )}

      {projected && (
        <div className="effect-card">
          <h3 className="effect-card__heading">Projected effect</h3>
          <div className="effect-card__rows">
            {netDeltas(projected.deltas).map((delta) => (
              <DeltaRow key={delta.path} delta={delta} />
            ))}
          </div>
          <AssumptionChips assumptions={projected.assumptions} noConcurrentWriterViolated={result !== null && result.reconciliation.status !== "confirmed"} />
        </div>
      )}

      {result && (
        <>
          <div className="effect-card">
            <h3 className="effect-card__heading">Observed effect</h3>
            <div className="effect-card__rows">
              {netDeltas(result.observedDeltas).map((delta) => (
                <DeltaRow key={delta.path} delta={delta} />
              ))}
            </div>
          </div>

          <div className="reconciliation-verdict">
            {result.reconciliation.status === "confirmed" && (
              <StatusChip tone="positive" label={`Confirmed — every predicted change matched (${result.reconciliation.matched.length} delta(s))`} />
            )}
            {result.reconciliation.status === "drifted" && (
              <>
                <StatusChip tone="negative" label="Drifted" />
                <DeltaRow claim="predicted" delta={result.reconciliation.expected} />
                <DeltaRow claim="actual" delta={result.reconciliation.actual} />
              </>
            )}
            {result.reconciliation.status === "unprojected" && (
              <>
                <StatusChip tone="negative" label="Unprojected" />
                <DeltaRow claim="actual" delta={result.reconciliation.actual} />
              </>
            )}
          </div>

          {result.reconciliation.status !== "confirmed" && (
            <div className="effect-card">
              <h3 className="effect-card__heading">stock.reserved, on its own</h3>
              <p className="demo-hint">
                reconcile() reports one fact per call (its own header: ascending-path priority — the
                verdict above is the whole pipeline&rsquo;s real answer, and &ldquo;reservations&rdquo;
                genuinely sorts first). This is the SAME reconcile(), called a second time, with both sides
                sliced to path === &ldquo;stock.reserved&rdquo; — the documented way to see a second real
                fact, never a fabricated one.
              </p>
              {result.stockReservedReconciliation.status === "confirmed" && (
                <StatusChip tone="positive" label="stock.reserved — confirmed" />
              )}
              {result.stockReservedReconciliation.status === "drifted" && (
                <>
                  <StatusChip tone="negative" label="stock.reserved — drifted" />
                  <DeltaRow claim="predicted" delta={result.stockReservedReconciliation.expected} />
                  <DeltaRow claim="actual" delta={result.stockReservedReconciliation.actual} />
                </>
              )}
              {result.stockReservedReconciliation.status === "unprojected" && (
                <>
                  <StatusChip tone="negative" label="stock.reserved — unprojected" />
                  <DeltaRow claim="actual" delta={result.stockReservedReconciliation.actual} />
                </>
              )}
            </div>
          )}

          <div className="rollback-panel">
            {result.reconciliation.status === "confirmed" ? (
              <>
                <StatusChip tone="neutral" label="Rollback — available, unused" />
                {result.rollback.kind === "runnable" && (
                  <details>
                    <summary>steps it would have run (never invoked — reconciliation confirmed)</summary>
                    <div className="effect-card__rows">
                      {result.rollback.steps.map((step, i) => (
                        <DeltaRow key={i} delta={step} />
                      ))}
                    </div>
                  </details>
                )}
              </>
            ) : (
              <>
                {result.rollback.kind === "runnable" && (
                  <details open>
                    <summary>rollback steps executed</summary>
                    <div className="effect-card__rows">
                      {result.rollback.steps.map((step, i) => (
                        <DeltaRow key={i} delta={step} />
                      ))}
                    </div>
                  </details>
                )}

                {result.honestInversionVerified !== null && (
                  <StatusChip
                    tone={result.honestInversionVerified ? "positive" : "negative"}
                    label={`honesty check (verifyStepsAreHonestInversion): ${result.honestInversionVerified ? "PASS" : "FAIL"}`}
                  />
                )}

                {revealed && result.rollbackOutcome && (
                  <RollbackVerdictSection
                    outcome={result.rollbackOutcome}
                    worldBeforeThisWrite={result.worldBeforeThisWrite}
                    injectLog={injectLog}
                  />
                )}
              </>
            )}
          </div>

          <p className="mono trust-readout">
            SimulatorTrust — {trust.actionType}: {result.trustBefore.consecutiveNonConfirmed} →{" "}
            {result.trustAfter.consecutiveNonConfirmed} (flips a stricter mode at {DEFAULT_TRUST_THRESHOLD})
          </p>
        </>
      )}
    </section>
  );
}
