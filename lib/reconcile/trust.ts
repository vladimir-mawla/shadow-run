import type { Reconciliation } from "../contracts/reconciliation.js";
import type { SimulatorTrust } from "../contracts/simulator-trust.js";

/**
 * The single source of truth for the trust-gate threshold, per this
 * milestone's own design question ("is the threshold configurable, and
 * if so, where does the configuration live, and what stops it drifting
 * from what tests assert"). It lives here -- one named, exported constant
 * in `lib/reconcile/**` -- rather than as a bare literal `3` typed
 * separately inside `requiresPreValidatedRollback` and inside its own
 * test. `__tests__/trust.test.ts` imports THIS constant to build its
 * "N-1 does not flip, N does" fixture rather than hardcoding a number: if
 * this constant is ever changed, the test's own notion of "N" moves with
 * it automatically, so the test can never silently assert a stale
 * threshold the code no longer uses. That is what "stops it from
 * drifting" here -- not a comment asking a future author to keep two
 * numbers in sync, but there being only one number to begin with.
 *
 * WHY 3, AND WHY THIS IS A DEMO-SCALE CHOICE, STATED AS SUCH: chosen to be
 * small enough that a judge or an independent verifier can watch the
 * counter cross it within a handful of calls on screen (plan §A.3's own
 * framing: "something a judge ... can compute in their head from the
 * sequence on screen"), and larger than 1 specifically so that a single
 * `drifted`/`unprojected` reconciliation is never, by itself, enough to
 * flip the gate -- one bad reconciliation is exactly the kind of
 * ordinary, expected noise (plan §A.3's own accepted cost: "a domain
 * that's flaky in an alternating way ... never trips the gate") this
 * project does not want to treat as proof the simulator itself is wrong.
 * This is a judgment call, not a derived constant -- there is no formula
 * in the plan that produces "3" -- and it is named here as exactly that,
 * rather than presented as an obvious default.
 */
export const DEFAULT_TRUST_THRESHOLD = 3;

/**
 * Builds a fresh `SimulatorTrust` for an `actionType` that has never been
 * reconciled before -- `consecutiveNonConfirmed`/`totalObserved` both `0`,
 * matching `simulator-trust.ts`'s own note that a caller needs to be able
 * to tell "0 because it just reset" apart from "0 because nothing has run
 * yet" (that distinction lives in `totalObserved`, not in this function --
 * this function only fixes the STARTING point both fields share).
 */
export function makeInitialTrust(actionType: string): SimulatorTrust {
  return { actionType, consecutiveNonConfirmed: 0, totalObserved: 0 };
}

/**
 * The reset-on-success arithmetic itself -- plan §A.3 / `simulator-
 * trust.ts`'s header, implemented exactly as both already specify, and no
 * more: `confirmed` resets `consecutiveNonConfirmed` to `0`; anything
 * else (`drifted` OR `unprojected` -- this function does not need to
 * distinguish the two, and deliberately does not via `reconciliation.
 * status !== "confirmed"` rather than an exhaustive switch, since both
 * non-`confirmed` branches do the identical thing here) increments it by
 * exactly one. `totalObserved` increments unconditionally either way --
 * it counts every reconciliation ever seen for this `actionType`,
 * confirmed or not.
 *
 * Pure and total: never mutates `trust`, always returns a new value, and
 * has no branch that fails to return for any `Reconciliation` (the
 * three-way status union is fully covered by the binary confirmed/not-
 * confirmed split above, so there is no `assertNeverReconciliation` call
 * here to prove exhaustiveness against -- a fourth `Reconciliation`
 * status would still fall into the same "not confirmed -> increment"
 * branch, correctly, without this function needing to know it exists).
 */
export function updateTrust(trust: SimulatorTrust, reconciliation: Reconciliation): SimulatorTrust {
  return {
    actionType: trust.actionType,
    consecutiveNonConfirmed: reconciliation.status === "confirmed" ? 0 : trust.consecutiveNonConfirmed + 1,
    totalObserved: trust.totalObserved + 1,
  };
}

/**
 * The mechanical gate flip itself -- plan §A.3: "when the counter reaches
 * a fixed threshold, the gate mechanically flips." `>=`, not `===`,
 * because a caller that skips calling this function for a few
 * reconciliations and then calls it once, late, must still see the gate
 * correctly flipped (a strict `===` would let the counter walk PAST the
 * threshold without a caller ever observing `true`, if it happened to
 * check on the wrong step) -- but `>=` and `===` are provably identical
 * in practice here, because `consecutiveNonConfirmed` only ever changes
 * by exactly one step at a time (`updateTrust` above never jumps it by
 * more than 1), so this is defense against a caller's OWN irregular
 * polling, not a claim that the counter itself can skip the threshold.
 *
 * `threshold` defaults to `DEFAULT_TRUST_THRESHOLD` rather than being
 * hardcoded, so a caller (a domain, M6; a test) can exercise a different
 * threshold without this file changing, while every caller that does not
 * care still gets the one project-wide default.
 */
export function requiresPreValidatedRollback(trust: SimulatorTrust, threshold: number = DEFAULT_TRUST_THRESHOLD): boolean {
  return trust.consecutiveNonConfirmed >= threshold;
}
