import type { Delta } from "../../lib/contracts/index.js";
import { deepEqual } from "../../lib/rollback/index.js";

/**
 * `netDeltas` — collapses an ORDERED `Delta[]` that may touch the SAME
 * `path` more than once (a genuine multi-step staged pipeline — the infra
 * domain, `domains/infra/domain.ts`, is the one place in this milestone
 * that produces such a thing) down to at most one `Delta` per `path`.
 *
 * WHY THIS EXISTS AT ALL: `lib/reconcile`'s `reconcile()` (ADR 0003,
 * Decision 2) throws `MalformedDeltaArrayError` the moment either its
 * `predicted` or `observed` argument has two entries for the same `path`
 * — a deliberate, frozen, fail-closed rule, not a bug to route around.
 * TWO of this milestone's domains produce a raw pipeline that repeats a
 * `path`: infra (`desiredCount`, drained then restored around an
 * `instanceType` swap) and, for a different reason, every domain that
 * grows an existing array via `domains/shared/grow.ts`'s `growArraySteps`
 * (`remove` the old array, `append` the new one — both on the SAME
 * `path`). See that file's header and `.genesis/decisions/0005-domains.md`
 * for why the raw, repeated-path form is REQUIRED, not accidental:
 * `lib/simulate`'s frozen `checkConsistency` needs to see it exactly that
 * way to accept an `append` at all, or (for infra) simply because that is
 * the real, ordered pipeline `applyReal`/`proposeRollback` run.
 *
 * CALLED ONLY BY `scripts/demo-domains.ts` — NOT BY ANY DOMAIN'S OWN
 * `project()`/`applyReal()`/`proposeRollback()`. Every domain in this
 * milestone returns its RAW, un-netted pipeline from all three of those
 * functions (`checkConsistency`, `applyDeltas`, and `invertDelta` all
 * tolerate a repeated path perfectly well — only `reconcile()` does not).
 * The wiring script nets BOTH the predicted (`ProjectedEffect.deltas`,
 * already validated by `simulate()`'s internal `checkConsistency` against
 * its RAW form) and observed sides, immediately before either is handed
 * to `reconcile()`, and nowhere else — netting earlier would break
 * `checkConsistency` (see `grow.ts`), and netting later never happens
 * because `reconcile()` is the last consumer with any objection to a
 * repeated path in the first place.
 *
 * NET RULE: for each `path`, `before` is the value at the FIRST
 * occurrence, `after` is the value at the LAST — i.e. exactly the net
 * change across the whole pipeline, which is what a single before/after
 * `World` snapshot diff would show regardless of how many intermediate
 * steps happened in between. A path whose net `before`/`after` are equal
 * (infra's `desiredCount`: drained then fully restored) is DROPPED
 * entirely — there is nothing to report at that path once the pipeline as
 * a whole has run, matching `Delta`'s own "a diff only ever contains an
 * entry for a path that actually changed" discipline (ADR 0003's own
 * framing of `ObservedEffect`).
 *
 * `kind` is taken from the LAST occurrence at that `path` — for this
 * milestone's one real user of this function (infra's `desiredCount`),
 * every occurrence is already `"set"`, so this is not a live judgment
 * call today; it is named plainly anyway so a future path with a
 * genuinely mixed `kind` sequence does not get an unstated default.
 */
export function netDeltas(steps: ReadonlyArray<Delta>): ReadonlyArray<Delta> {
  const order: string[] = [];
  const firstBefore = new Map<string, unknown>();
  const lastAfter = new Map<string, unknown>();
  const lastKind = new Map<string, Delta["kind"]>();

  for (const step of steps) {
    if (!firstBefore.has(step.path)) {
      order.push(step.path);
      firstBefore.set(step.path, step.before);
    }
    lastAfter.set(step.path, step.after);
    lastKind.set(step.path, step.kind);
  }

  const net: Delta[] = [];
  for (const path of order) {
    const before = firstBefore.get(path);
    const after = lastAfter.get(path);
    if (deepEqual(before, after)) continue; // net no-op across the whole pipeline — nothing changed, nothing to report.
    net.push({ path, before, after, kind: lastKind.get(path) as Delta["kind"] });
  }
  return net;
}
