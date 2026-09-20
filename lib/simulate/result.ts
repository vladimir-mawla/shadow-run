import type { ProjectedEffect } from "../contracts/index.js";

/**
 * `SimulationResult` — what `simulate()` actually returns: NEVER a bare
 * `ProjectedEffect`, always this discriminated union. This is the
 * "fail-closed" answer to the build brief's own question ("what happens
 * when an adapter throws, returns a malformed `ProjectedEffect`, or
 * returns deltas that contradict its own `resultingFingerprint`?") made
 * into a type, the same way `Reconciliation`
 * (`lib/contracts/reconciliation.ts`) turns "what happened" into a type
 * instead of a boolean plus a side channel. See
 * `.genesis/decisions/0002-simulate.md` for the full argument.
 *
 * WHAT "FAIL CLOSED" MEANS HERE, STATED PLAINLY: a caller of `simulate()`
 * can only reach a real `ProjectedEffect` by narrowing `ok: true` — every
 * other branch is a NAMED reason `simulate()` refused to hand back
 * anything the adapter claimed, and no failure variant also carries a
 * usable-looking effect "for reference" alongside it (that would invite a
 * caller to reach past the discriminant and use it anyway). "Closed" is
 * closed to *proceeding*: a caller cannot accidentally execute a real
 * write against an effect this function itself could not verify, because
 * there is no code path that hands one back under any failure variant. It
 * is not "closed" in the sense of silent — every failure names exactly
 * why, in enough detail to act on (which delta, which field, which
 * claimed vs. actual value).
 *
 * FOUR FAILURE KINDS, IN THE ORDER `simulate.ts` ACTUALLY CHECKS THEM:
 *
 *   1. `invalid-world`       — the INPUT `World` itself is already
 *                               internally inconsistent (its own `data`
 *                               does not hash to its own `fingerprint`) —
 *                               caught before the adapter is ever called,
 *                               because running a shadow execution against
 *                               state that already lies about itself would
 *                               make every later check meaningless.
 *   2. `adapter-threw`       — `project()` raised, for any reason. Caught
 *                               and named rather than left to propagate
 *                               raw — see `adapter.ts`'s header for why a
 *                               thrown mutation-on-frozen-data attempt is
 *                               exactly the shape this is expected to
 *                               sometimes catch.
 *   3. `malformed-effect`    — `project()` returned, but the value isn't a
 *                               well-shaped `ProjectedEffect`
 *                               (`effect-validation.ts`).
 *   4. `inconsistent-effect` — the value IS well-shaped, but applying its
 *                               own claimed `deltas` to the input `World`
 *                               does not produce its own claimed
 *                               `resultingFingerprint`, or an individual
 *                               delta's claimed `before` doesn't match
 *                               reality (`consistency.ts` — both layers
 *                               described there report through this one
 *                               variant, since both are "this effect
 *                               contradicts itself," just at different
 *                               granularity; `problems` lists every
 *                               contradiction found).
 *
 * WHY `problems`/`error` ARE PLAIN STRINGS, EVEN THOUGH `ProjectedEffect`
 * FIELDS LIKE `assumptions` MUST NEVER BE FREE TEXT: `projected-effect.ts`
 * scopes its own "no field may hold a model's prose" claim explicitly to
 * `ProjectedEffect` itself — a claim a domain's `project()` makes ABOUT
 * the world. These fields run the opposite direction: THIS ENGINE's own
 * diagnostic account of why it rejected something. Closing that
 * vocabulary too would mean inventing a closed enum of every possible
 * shape-validation and consistency failure ahead of time, for a channel a
 * model never writes to and a `ProjectedEffect` never reads from — see
 * `effect-validation.ts`'s header for the same scoping note made once and
 * cross-referenced here rather than repeated in full.
 */
export type SimulationResult =
  | { readonly ok: true; readonly effect: ProjectedEffect }
  | { readonly ok: false; readonly failure: SimulationFailure };

export type SimulationFailure =
  | { readonly kind: "invalid-world"; readonly declaredFingerprint: string; readonly actualFingerprint: string }
  | { readonly kind: "adapter-threw"; readonly error: string }
  | { readonly kind: "malformed-effect"; readonly problems: readonly string[] }
  | { readonly kind: "inconsistent-effect"; readonly problems: readonly string[] };

/**
 * Exhaustiveness helper for `switch (failure.kind)`, mirroring
 * `assertNeverReconciliation` (`lib/contracts/reconciliation.ts`) — the
 * same "a fifth failure kind added later fails to compile until handled
 * everywhere" discipline, applied to this milestone's own union. Never
 * called at runtime for the same reason its sibling isn't: the `never`
 * parameter type makes that unreachable for any value TypeScript itself
 * considers exhaustively handled.
 */
export function assertNeverSimulationFailure(value: never): never {
  throw new Error(`Unreachable: unhandled SimulationFailure kind ${JSON.stringify(value)}`);
}
