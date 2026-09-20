import type { Action } from "../../lib/simulate/index.js";
import type { AssumptionKind, Delta, ProjectedEffect, Rollback, World } from "../../lib/contracts/index.js";
import { applyDeltas, buildRollbackSteps } from "../../lib/rollback/index.js";
import type { AppliedReal, DomainAdapter } from "../types.js";
import { growArraySteps } from "../shared/grow.js";

/**
 * Calendar reschedule — the baseline domain. See
 * `.genesis/decisions/0005-domains.md` §Calendar for why this domain
 * exists (the control condition: single organizer, single writer, nothing
 * structurally capable of contention) and `m6-domain-cases.md` §1 for the
 * two cases built against it (C1 — reschedule; C2 — add an attendee).
 */
// A TYPE ALIAS to an object literal, deliberately not an `interface` — only a fresh object-literal type
// gets the implicit-index-signature compatibility `Json`'s `{ readonly [key: string]: Json }` branch
// relies on; a same-shaped `interface` fails `extends Json` even though it describes an identical shape.
// See `lib/simulate/__tests__/fixtures.ts`'s own `StockState` for the precedent this follows.
export type CalendarEventState = {
  readonly eventId: string;
  readonly title: string;
  readonly organizer: string;
  readonly attendees: ReadonlyArray<string>;
  readonly startAt: string;
  readonly endAt: string;
  readonly room: string;
  readonly status: "confirmed" | "cancelled";
};

const ASSUMPTIONS: ReadonlyArray<AssumptionKind> = ["no-concurrent-writer", "clock-monotonic"];

/**
 * The ONE place this domain's business logic lives — called identically
 * by `project()` (against a frozen clone) and `applyReal()` (against the
 * real `World`), per `sim-plan.md` Approach C: "the same state-transition
 * logic the real executor runs." Returns an ORDERED `Delta[]`; for this
 * domain the order never matters (each action touches disjoint paths) but
 * the shape is kept identical to infra's genuinely-ordered pipeline so
 * both domains are driven the same way by `project`/`applyReal` below.
 *
 * WHOLE-VALUE SNAPSHOTS, NOT ELEMENTS (one deviation from the design
 * doc's literal case JSON — see ADR 0005 for the full argument): the
 * design doc's own `addAttendee` example writes the `append` delta's
 * `before`/`after` as a single email address. `lib/rollback`'s frozen
 * `path.ts`/ADR 0004 (Decision 1) settled this before M6 started: `Delta`
 * `before`/`after` are the WHOLE value at `path`, for every `kind`,
 * including `append`/`remove` — the entire `attendees` array, not the
 * one email being added. This function follows the frozen rule, not the
 * design doc's literal example.
 *
 * A SECOND deviation, forced rather than chosen: `addAttendee` uses
 * `growArraySteps` (two raw steps: `remove` the old array, `append` the
 * new one) instead of a single `append` delta — see that function's own
 * header for the discovered M3/M5 conflict this works around, entirely
 * within `domains/**`'s own authority.
 */
function computeSteps(action: Action, world: World<CalendarEventState>): Delta[] {
  switch (action.type) {
    case "reschedule": {
      const params = action.params as { readonly newStartAt: string; readonly newEndAt: string };
      return [
        { path: "startAt", before: world.data.startAt, after: params.newStartAt, kind: "set" },
        { path: "endAt", before: world.data.endAt, after: params.newEndAt, kind: "set" },
      ];
    }
    case "addAttendee": {
      const params = action.params as { readonly attendeeEmail: string };
      const before = world.data.attendees;
      const after = [...before, params.attendeeEmail];
      return [...growArraySteps("attendees", before, after)];
    }
    default:
      throw new Error(`calendar domain: unknown action type "${action.type}"`);
  }
}

/**
 * `deltas: steps` — the RAW, un-netted pipeline, not `netDeltas(steps)`.
 * `lib/simulate`'s frozen `checkConsistency` (M3) runs against WHATEVER
 * `project()` returns, applying each delta IN ORDER against the real
 * input `World.data` — it needs to see `growArraySteps`'s two steps
 * exactly as `computeSteps` produced them (`remove` the old `attendees`
 * array, THEN `append` the new one) to accept an `append` at all (see
 * `domains/shared/grow.ts`'s header). Netting is deferred entirely to
 * `scripts/demo-domains.ts`, which nets BOTH the predicted and observed
 * sides immediately before calling `reconcile()` — the only consumer
 * that actually requires at most one `Delta` per `path` (ADR 0003,
 * Decision 2). `checkConsistency` has no such requirement; giving it the
 * raw pipeline is what makes it accept this domain's own `append` at
 * all.
 */
function project(action: Action, world: World<CalendarEventState>): ProjectedEffect {
  const steps = computeSteps(action, world);
  const final = applyDeltas(world, steps);
  return {
    deltas: steps,
    resultingFingerprint: final.fingerprint,
    assumptions: ASSUMPTIONS,
    producedBy: "shadow-execution",
  };
}

function applyReal(action: Action, world: World<CalendarEventState>): AppliedReal<CalendarEventState> {
  const steps = computeSteps(action, world);
  return { world: applyDeltas(world, steps), observedDeltas: steps };
}

/**
 * `steps = buildRollbackSteps(observedDeltas)` — the engine-owned
 * reverse-then-invert (`lib/rollback`, ADR 0004 Decision 3), never a
 * hand-rolled inversion. `projectedRestoration.resultingFingerprint` is
 * `worldBeforeThisWrite.fingerprint` — not a recomputed hash of anything
 * this function derives itself — because that is the exact value
 * `runRollback`'s cheap self-consistency check (ADR 0004, Decision 7)
 * compares against before running anything.
 */
function proposeRollback(
  observedDeltas: ReadonlyArray<Delta>,
  worldBeforeThisWrite: World<CalendarEventState>,
): Rollback {
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

export const calendarDomain: DomainAdapter<CalendarEventState> = { project, applyReal, proposeRollback };
