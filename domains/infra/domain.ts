import type { Action } from "../../lib/simulate/index.js";
import type { AssumptionKind, Delta, ProjectedEffect, Rollback, World } from "../../lib/contracts/index.js";
import { applyDeltas, buildRollbackSteps } from "../../lib/rollback/index.js";
import type { AppliedReal, DomainAdapter } from "../types.js";

/**
 * Infra resize — exercises a multi-step rollback PIPELINE. See
 * `.genesis/decisions/0005-domains.md` §Infra for the re-scoping this
 * milestone made, following `m6-domain-cases.md` §4's own conclusion:
 * nothing in the frozen `Delta`/`ProjectedEffect`/`Rollback` types
 * carries a cost or duration field, so this domain cannot show "rollback
 * is slow or costly" as anything an engine reads or gates on — the
 * `monthlyCostUsd`/`provisioningState` bookkeeping below is narrative
 * color a human reads, never a value the pipeline acts on. What this
 * domain DOES honestly contribute, and the only claim its own code or
 * comments make: a genuinely ORDERED, multi-step `Rollback.runnable
 * .steps` — the one shape nothing else in this milestone's four domains
 * exercises even once (every other `runnable` rollback here is one or
 * three tightly-related deltas from a single action).
 */
// A TYPE ALIAS to an object literal, not an `interface` — see `calendar/domain.ts`'s identical note.
export type InfraResourceState = {
  readonly resourceId: string;
  readonly instanceType: string;
  readonly desiredCount: number;
  readonly provisioningState: "steady" | "resizing";
  readonly monthlyCostUsd: number;
};

const ASSUMPTIONS: ReadonlyArray<AssumptionKind> = ["no-concurrent-writer", "clock-monotonic"];

/**
 * The staged pipeline itself: drain `desiredCount` by half, swap
 * `instanceType`, restore `desiredCount`, update `monthlyCostUsd` — FOUR
 * `set` deltas in a fixed order, `desiredCount` touched TWICE. This is
 * the one domain in this milestone whose real execution revisits a path
 * more than once within a single action. `project()`, `applyReal()`, and
 * `proposeRollback()` below ALL use this raw, un-netted pipeline directly
 * — `domains/shared/net.ts`'s `netDeltas` is applied only by
 * `scripts/demo-domains.ts`, to BOTH the predicted and observed sides,
 * immediately before either is handed to `reconcile()` (ADR 0003,
 * Decision 2: at most one `Delta` per `path`, a constraint `reconcile()`
 * alone imposes — `checkConsistency`, `applyDeltas`, and `invertDelta`
 * all tolerate a repeated path perfectly well).
 *
 * `targetMonthlyCostUsd` is a PARAMETER of the action, not a value this
 * function derives from a pricing formula — this milestone models no real
 * cloud billing; the number is exactly what the case declares it to be,
 * the same way a real infra system's own pricing table would be an input
 * this logic reads, not computes from scratch.
 */
function computeSteps(action: Action, world: World<InfraResourceState>): Delta[] {
  if (action.type !== "resize") {
    throw new Error(`infra domain: unknown action type "${action.type}"`);
  }
  const params = action.params as { readonly targetInstanceType: string; readonly targetMonthlyCostUsd: number };
  const desiredBefore = world.data.desiredCount;
  const half = Math.floor(desiredBefore / 2);
  const instanceBefore = world.data.instanceType;
  const costBefore = world.data.monthlyCostUsd;
  return [
    { path: "desiredCount", before: desiredBefore, after: half, kind: "set" },
    { path: "instanceType", before: instanceBefore, after: params.targetInstanceType, kind: "set" },
    { path: "desiredCount", before: half, after: desiredBefore, kind: "set" },
    { path: "monthlyCostUsd", before: costBefore, after: params.targetMonthlyCostUsd, kind: "set" },
  ];
}

// `deltas: steps` — the RAW four-step pipeline, not netted; see the file header. `checkConsistency`
// applies each step in order against the real input World.data and tolerates `desiredCount` appearing
// twice just fine; netting for `reconcile()` happens entirely in `scripts/demo-domains.ts`.
function project(action: Action, world: World<InfraResourceState>): ProjectedEffect {
  const steps = computeSteps(action, world);
  const final = applyDeltas(world, steps);
  return {
    deltas: steps,
    resultingFingerprint: final.fingerprint,
    assumptions: ASSUMPTIONS,
    producedBy: "shadow-execution",
  };
}

function applyReal(action: Action, world: World<InfraResourceState>): AppliedReal<InfraResourceState> {
  const steps = computeSteps(action, world);
  // `observedDeltas` is the RAW, un-netted, four-step pipeline — kept
  // exactly as executed so `proposeRollback` below can invert the real,
  // ordered pipeline, not a lossy two-entry summary of it.
  return { world: applyDeltas(world, steps), observedDeltas: steps };
}

/**
 * `buildRollbackSteps(observedDeltas)` on the RAW four-step pipeline
 * produces a genuinely four-step, correctly ORDERED rollback (reverse the
 * pipeline, invert each step — ADR 0004, Decision 3) — restore
 * `monthlyCostUsd`, drain `desiredCount`, swap `instanceType` back, then
 * restore `desiredCount` again. This is the entire, honest distinction
 * this domain contributes over calendar's one-delta-and-its-mirror: four
 * ordered steps versus one.
 */
function proposeRollback(observedDeltas: ReadonlyArray<Delta>, worldBeforeThisWrite: World<InfraResourceState>): Rollback {
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

export const infraDomain: DomainAdapter<InfraResourceState> = { project, applyReal, proposeRollback };
