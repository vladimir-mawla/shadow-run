import type { Delta } from "../lib/contracts/index";
import { deepEqual } from "../lib/reconcile/deep-equal";

/**
 * PURE RENDERING RULES for a `Delta` that came off a `Reconciliation`
 * (`.drifted.expected`/`.actual`, `.unprojected.actual`, `.confirmed.matched`
 * — `lib/contracts/reconciliation.ts`). No JSX here on purpose: keeping the
 * decision "which sentence is safe to print" as a plain function, separate
 * from `DeltaRow.tsx`'s markup, is what makes it testable against real
 * `Delta`/`Reconciliation` values without a DOM.
 *
 * THE PROBLEM THIS FILE EXISTS TO SOLVE (`.genesis/decisions/0003-reconcile.md`'s
 * forward note to M8, quoted, not paraphrased, where it matters):
 * `Reconciliation.drifted.actual` (and `.unprojected.actual`) MAY be
 * SYNTHESIZED rather than genuinely observed — ADR 0003 Decision 4, the
 * "vanished prediction" case, where `reconcile()` constructs
 * `{ path, before: predicted.before, after: predicted.before, kind: "set" }`
 * because nothing was actually observed to change at that path. A
 * synthesized `actual` is STRUCTURALLY IDENTICAL to a real one — there is no
 * field anywhere on `Reconciliation` that marks the difference.
 *
 * WHAT `hasNoNetChange` DOES AND DOES NOT PROVE — stated at full strength,
 * not softened, because softening it is exactly the mistake the ADR warns
 * against: this function detects that `delta.before` and `delta.after` are
 * deep-equal, i.e. NO NET CHANGE at `delta.path`. It does NOT detect, and
 * cannot be made to detect, WHY they are equal — a synthesized no-op
 * (Decision 4) and a genuinely-observed no-op (a real diff that happened to
 * record "nothing moved here") produce the identical boolean from this
 * function, because "nothing in `reconcile()` can tell the two apart" (ADR
 * 0003's own words). Naming this function `isSynthesized` or `wasObserved`
 * would claim knowledge this function does not have; `hasNoNetChange` claims
 * exactly, and only, what it checks.
 *
 * What rules out treating a genuine no-op as suspicious is an EXTERNAL
 * contract this file cannot verify — `ObservedEffect`'s own definition
 * (plan §A.3 step 3) says a real diff only ever contains an entry for a path
 * that actually changed. This file does not and cannot check that a given
 * `Delta` came from code that honored it; it only ever answers "is
 * `before` deep-equal to `after`," which is the one fact that determines
 * which sentence below is safe to print without overclaiming an
 * observation that may not have happened.
 */

/**
 * True iff `delta.before` and `delta.after` are structurally deep-equal —
 * see the file header for exactly what this does and does not prove.
 * Deep-equality (not `===`) matters here for the same reason it matters in
 * `lib/reconcile/reconcile.ts`: a domain's `before`/`after` can be an object
 * (e.g. a reservation record), and two structurally-identical-but-not-
 * identical objects (built fresh at each snapshot) must compare as "no net
 * change," not as a spurious change purely because of reference identity.
 */
export function hasNoNetChange(delta: Delta): boolean {
  return deepEqual(delta.before, delta.after);
}

/**
 * Renders an arbitrary `Delta.before`/`.after` value for display. Kept
 * intentionally simple — this project's four domains (plan §D) only ever
 * put JSON-shaped primitives, plain objects, and arrays into a `Delta`
 * (the same `World.data` constraint `lib/contracts/world.ts` enforces one
 * layer up), so there is no exotic value type this needs to special-case.
 * Falls back to `String(value)` only if `JSON.stringify` itself throws
 * (e.g. a `BigInt` slipping past `isPlainData`'s known gaps, `world.ts`'s
 * own "KNOWN, UNCLOSED GAP" note) — degrading to *something* legible rather
 * than throwing out of a render function.
 */
export function formatDeltaValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Which side of a `Reconciliation` a `Delta` being rendered by `describeReconciledDelta` is. */
export type ReconciledDeltaLabel = "predicted" | "actual";

/**
 * THE ONE SHARED RENDERING RULE (m8-demo-design.md §3), applied
 * UNCONDITIONALLY — every call runs `hasNoNetChange` first, regardless of
 * which `Reconciliation` variant or which side (`expected`/predicted or
 * `actual`) the caller is rendering. There is deliberately no second branch
 * for "this drift came from a case I trust" versus "this drift came from a
 * case I don't" — the ADR's own point is that `reconcile()`'s output gives
 * this function no way to tell those apart, so a rendering function that
 * pretended otherwise (e.g. by trusting `expected` unconditionally and only
 * guarding `actual`) would be inventing a distinction the data doesn't
 * support. Both sides run the identical check; `expected` (the predicted
 * side) is in practice never synthesized by `reconcile()` today — only
 * Decision 4's "vanished prediction" case synthesizes an `actual` — but
 * this function does not special-case that asymmetry, so a future
 * `Reconciliation`-shaped input that violated it would still render safely.
 *
 * Text is the ADR's own prescribed language, reused verbatim for the
 * `"actual"` label ("no change was observed at this path," never
 * "observed: X") — not paraphrased into something more confident than the
 * check supports. The `"predicted"` label mirrors it structurally rather
 * than reusing the word "observed" for a side that was never observed at
 * all.
 */
export function describeReconciledDelta(delta: Delta, label: ReconciledDeltaLabel): string {
  if (hasNoNetChange(delta)) {
    return label === "actual" ? "no change was observed at this path" : "no change was predicted at this path";
  }
  return `${label}: ${formatDeltaValue(delta.after)}`;
}
