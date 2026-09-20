import type { Json } from "../contracts/index.js";

/**
 * `Action` — what's proposed: a domain, a type, and plain-data parameters.
 * Deliberately NOT one of `lib/contracts/**`'s four irreducible types
 * (`World`, `ProjectedEffect`, `Reconciliation`, `Rollback` — ADR 0001) and
 * not defined there: `sim-plan.md` §A.1 names `Action` as `simulate()`'s
 * other input but is explicit that scoring an action's cost or reversibility
 * class is NOT this project's job ("that question belongs to the
 * decision-engine sibling and is explicitly not re-implemented here"). M1
 * fixed the shape of the four contracts and never defined `Action` at all
 * (confirmed by grep before writing this file — the only hit is a comment
 * in `rollback.ts` recounting decision-engine's `Prohibition.matches`
 * history, not a real export). So this type is M3-owned, lives inside this
 * milestone's own freeze boundary, and is kept to the minimum `simulate()`
 * itself needs to hand a domain adapter — not a richer action model that
 * would duplicate decision-engine's own `Action` contract for a different
 * purpose.
 *
 * `params` is constrained to `Json` for the exact same reason `World.data`
 * is (world.ts's file header): whatever a domain's `project()` reads off
 * an action must itself be plain, serializable, hashable-if-needed data —
 * a function-valued `params` field would let a "shadow execution" close
 * over live, unserializable state exactly the way `Rollback`'s rejected
 * closure design would have (ADR 0001, Decision 5), just one call earlier
 * in the pipeline.
 *
 * REJECTED ALTERNATIVE: importing/reusing decision-engine's own `Action`
 * type as a shared dependency. `sim-plan.md`'s own closing section ("share
 * infrastructure only") is explicit that this project reuses infrastructure
 * patterns, never a shared conceptual-core npm package or type — every type
 * in its §A.5 is original to this project, and `Action` (though outside
 * §A.5's four) follows the same rule for consistency.
 */
export interface Action {
  /** Which domain this action targets — matches the `World.domain` it will be run against (checked at the `World`/`Action` boundary is deliberately NOT this file's job; a mismatch is a malformed call, and it's `simulate()`'s job, not this type's, to decide what to do about one). */
  readonly domain: string;
  /** The action's own type tag within its domain, e.g. "reschedule", "reserve", "send", "resize" — a plain string, matching `World.domain`'s own open-string precedent (world.ts) rather than a closed union: naming the real action types per domain is M6's job, not this milestone's. */
  readonly type: string;
  /** Plain-data parameters the domain's `project()` needs to compute a `ProjectedEffect` — see file header for why this is `Json`, not `unknown` or a richer, function-bearing shape. */
  readonly params: Json;
}
