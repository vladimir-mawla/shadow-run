import type { Delta } from "./delta.js";
import type { ProjectedEffect } from "./projected-effect.js";

/**
 * `Rollback` — a compensating operation that actually runs and is verified
 * to restore prior state, not merely a static claim that an action *could*
 * be undone (plan §A.4). This is a stronger, different claim than
 * decision-engine's `Reversibility` (`lib/cost-model/reversibility.ts`),
 * which classifies an action *type* once, in principle, and is never run.
 * `Rollback` is per-execution and per-instance: it either carries the exact
 * steps that will restore THIS write, or it names why none exist.
 *
 * WHY `runnable.steps` IS `ReadonlyArray<Delta>` — DATA — NEVER A CLOSURE.
 *
 * An earlier draft of this plan typed the runnable case as
 * `{ kind: "runnable"; compensate: (world: World) => World; ... }`. That
 * is the exact mistake decision-engine's own ADR history already made and
 * reversed, one layer down:
 *
 *   1. `Prohibition.matches` (`decision-engine/lib/decide/prohibition.ts`)
 *      started as a predicate closure over `Action`. It could not be
 *      serialized, so M5's audit trail (`.genesis/decisions/0003-audit-
 *      model.md`, Decision 3 "PROHIBITIONS") had to fall back to recording
 *      prohibitions BY ID and requiring the caller to re-supply the real
 *      predicates again at replay time — an honest, but real, workaround
 *      forced entirely by the closure's unserializability.
 *   2. ADR 0004 ("Value constraints") then hit the identical choice for
 *      `ValueConstraint` and, having already paid for the closure mistake
 *      once, built it as data from the start: a small discriminated union
 *      of operators (`equals`/`lte`/`gte`/`in`) plus a threshold, evaluated
 *      by one small, engine-owned, total function
 *      (`evaluateConstraint`) — never a domain-supplied predicate.
 *
 * `Rollback.runnable` repeats ADR 0004's fix rather than ADR 0003's
 * original mistake, and the stakes are higher here than they were for
 * either: rollback is the single claim in this whole project most worth
 * auditing after the fact ("I undid it" is a claim about the past a
 * verifier should be able to replay), and a closure cannot be recorded
 * into that record, cannot be re-run against it by an independent
 * verifier, and cannot be compared for equality against what that verifier
 * expects it to do (`Function.prototype.toString()`-scraping is not an
 * equality check anyone should have to trust).
 *
 * So `steps` is the SAME `Delta` type `ProjectedEffect.deltas` already
 * uses, inverted — `observedEffect.deltas.map(invertDelta)`, computed once
 * by the engine (M5's `invertDelta`, `lib/rollback/**` — a later freeze
 * boundary, not this milestone's) and then recorded verbatim. Executing a
 * rollback becomes `applyDeltas(mutatedWorld, rollback.steps)`, the exact
 * same generic interpreter M3/M4 use to apply deltas forward. This buys
 * back everything the closure gave up: `steps` can sit next to the `World`
 * it applied to in an audit-style record, a verifier can literally re-run
 * `applyDeltas(recordedPreWorld, recordedSteps)` and diff the result
 * against what was claimed, and two rollbacks can be compared with
 * `deepEqual`, not by inspecting function source text.
 *
 * `unavailable.blastRadius` is ALSO data, not a fabricated `steps` array —
 * a domain with no true inverse (the plan's outbound-notification domain,
 * §D.3: there is no `Delta` whose inversion means "the recipient never
 * read the email") must say so honestly rather than construct a `steps`
 * list that would apply cleanly against `World.data` while lying about
 * what happened in the real world.
 */
export type Rollback =
  | {
      readonly kind: "runnable";
      readonly steps: ReadonlyArray<Delta>;
      readonly projectedRestoration: ProjectedEffect;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
      readonly blastRadius: ReadonlyArray<Delta>;
    };
