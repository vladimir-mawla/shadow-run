import type { Delta } from "./delta.js";

/**
 * `Reconciliation` — predicted vs. observed, the falsifiability mechanism
 * (plan §A.3). This is mechanical, not judged: a later milestone (M4,
 * `lib/reconcile/**`) computes one of these three statuses by diffing a
 * `ProjectedEffect.deltas` array against an `ObservedEffect` (the same
 * `Delta[]` shape, computed the same way from two real `World` snapshots).
 * M1's job is only the shape — but the shape is where "three statuses,
 * exhaustively" gets locked in, because every later milestone that matches
 * on `Reconciliation.status` is checked against this exact union.
 *
 *   - `confirmed`   — every predicted delta matched an observed one,
 *                      hash-for-hash. Carries `matched`, the deltas that
 *                      agreed — not a bare boolean, so a caller can show
 *                      *what* was confirmed, not just that something was.
 *   - `drifted`     — a field the projection named came back with a
 *                      different value than predicted. Carries the exact
 *                      `expected` and `actual` `Delta` (same `path`,
 *                      different `after`) — never a summary string. This is
 *                      the status the plan's headline TOCTOU demo (§B)
 *                      lives in: "stock.reserved: predicted 42, observed
 *                      45" is exactly `expected`/`actual` rendered.
 *   - `unprojected` — the real execution changed something the projection
 *                      never predicted at all. Carries the one `actual`
 *                      `Delta` nobody saw coming — there is no `expected`
 *                      counterpart to name, because none was projected.
 *
 * WHY A DISCRIMINATED UNION ON `status`, NOT THREE BOOLEANS OR A SEVERITY
 * NUMBER: the plan's own §E.3 risk is "divergence is detected and logged,
 * but nothing downstream changes" — a `Reconciliation` that collapsed to
 * `{ matched: boolean; severity: number }` would let a caller silently
 * ignore *which kind* of mismatch happened while still technically
 * "handling reconciliation." A discriminated union with `assertNeverReconciliation`
 * (below) makes ignoring a status a compile error the moment a new status
 * is added, not a silent pass-through.
 */
export type Reconciliation =
  | { readonly status: "confirmed"; readonly matched: ReadonlyArray<Delta> }
  | { readonly status: "drifted"; readonly expected: Delta; readonly actual: Delta }
  | { readonly status: "unprojected"; readonly actual: Delta };

/**
 * Exhaustiveness helper for `switch (reconciliation.status)` — the same
 * pattern decision-engine's `assertNeverOutcome` (`lib/contracts/decision.ts`)
 * uses for its five-outcome union, applied here to `Reconciliation`'s three
 * statuses. Never called at runtime (the `never` parameter type makes that
 * impossible for any value TypeScript itself considers reachable); its only
 * job is to make an unhandled case a COMPILE error at the call site, not a
 * silent fallthrough discovered at runtime.
 *
 * This is what M1's success criteria means by "a fourth status added later
 * fails to compile until handled everywhere": add a fourth variant to
 * `Reconciliation` and every existing `switch` that ends its `default`
 * branch with `assertNeverReconciliation(reconciliation)` stops compiling,
 * because the un-narrowed remainder (the new variant) is no longer
 * assignable to `never`. See `__tests__/reconciliation.test.ts` for the
 * literal proof (a local four-status type standing in for "if a fourth
 * status existed").
 */
export function assertNeverReconciliation(value: never): never {
  throw new Error(`Unreachable: unhandled Reconciliation status ${JSON.stringify(value)}`);
}
