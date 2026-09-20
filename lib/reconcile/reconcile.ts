import type { Delta } from "../contracts/delta.js";
import type { Reconciliation } from "../contracts/reconciliation.js";
import { deepEqual } from "./deep-equal.js";

/**
 * `ObservedEffect` — plan §A.3 step 3: "the same `Delta[]` shape [as
 * `ProjectedEffect.deltas`], computed the same mechanical way `project()`
 * computes it, from the two real snapshots." `lib/contracts/**` never
 * defines an `ObservedEffect` type of its own (grep confirms it: every
 * mention of the word in that directory is a comment, not an export) —
 * deriving one from a real before/after `World` diff is M3/M6's job, not
 * this milestone's, and `lib/contracts` is frozen, so this alias lives
 * here rather than pretending M4 needs to widen the frozen directory to
 * name something that is, structurally, just another `Delta[]`.
 */
export type ObservedEffect = ReadonlyArray<Delta>;

/**
 * Thrown by `reconcile()` when either side's `Delta[]` contains more than
 * one entry for the same `path` — see this file's header for why that
 * makes `reconcile()` refuse to run rather than pick one arbitrarily.
 */
export class MalformedDeltaArrayError extends Error {
  constructor(side: "predicted" | "observed", path: string) {
    super(
      `reconcile(): the ${side} Delta[] contains more than one Delta for path "${path}". ` +
        `A ProjectedEffect/ObservedEffect is a DIFF between two World snapshots, and a diff has at ` +
        `most one entry per changed path by construction (plan §A.3) -- two Deltas sharing a path ` +
        `means the ${side} side is malformed upstream (M3's project(), or the snapshot-diff step that ` +
        `derives ObservedEffect), not something reconcile() can resolve by guessing which one is real.`,
    );
    this.name = "MalformedDeltaArrayError";
  }
}

/**
 * Indexes a `Delta[]` by `path`, throwing `MalformedDeltaArrayError` on a
 * duplicate rather than silently keeping the first or last occurrence.
 * See this file's header ("IS RECONCILIATION TOTAL?") for why a throw,
 * not a best-effort resolution, is the fail-closed answer here.
 */
function indexByPath(deltas: ReadonlyArray<Delta>, side: "predicted" | "observed"): ReadonlyMap<string, Delta> {
  const byPath = new Map<string, Delta>();
  for (const delta of deltas) {
    if (byPath.has(delta.path)) {
      throw new MalformedDeltaArrayError(side, delta.path);
    }
    byPath.set(delta.path, delta);
  }
  return byPath;
}

/**
 * Two `Delta`s that share a `path` (already guaranteed by every call site
 * below -- this function does not re-check `path`) are RECONCILED, in
 * this codebase's sense, only if `kind`, `before`, AND `after` all agree.
 *
 * WHY `kind` IS PART OF EQUALITY, NOT JUST THE RESULTING VALUE -- this is
 * the sharpest of the design questions this milestone was asked to
 * answer explicitly, not gloss over. Consider a predicted `{ kind: "set",
 * before: 5, after: 10 }` reconciled against an observed `{ kind:
 * "increment", before: 5, after: 10 }` at the same path: the FIELD ends
 * up at the same value either way, so a check that only compared
 * `before`/`after` would call this `confirmed`. It is treated as
 * `drifted` here instead, for a reason that is load-bearing, not
 * stylistic: M5's `invertDelta` (`lib/rollback/**`, sim-plan.md §A.4)
 * dispatches on `Delta.kind` to decide HOW to invert a delta --
 * `set`/`increment` invert by swapping `before`/`after`, but `remove`
 * inverts to a `set` and `append` inverts to a `remove` (asymmetric on
 * purpose). If a rollback is ever built from the OBSERVED delta (the
 * real effect that actually happened) while the projection's `kind` was
 * silently treated as "close enough" here, that is invisible right up
 * until an `unavailable`-shaped effect (say, an `append`) gets treated
 * as a `set`-shaped one and inverted the wrong way. Reconciliation is
 * this project's only mechanical checkpoint before that could happen, so
 * it is deliberately strict on `kind` even though the two example deltas
 * above are, in a narrower sense, "about the same change."
 *
 * REJECTED ALTERNATIVE: compare only `after` (or only the resulting
 * `World.fingerprint`, which M4 does not even have access to here --
 * `reconcile()` operates on `Delta[]`, not `World`). Rejected because
 * `resultingFingerprint` already exists on `ProjectedEffect` to answer
 * "did the state end up the same" -- `Reconciliation`'s job (plan §A.3)
 * is a stronger claim: did the recorded MECHANISM of change also match,
 * because that recorded mechanism is what a later rollback trusts.
 */
function deltasMatch(predicted: Delta, observed: Delta): boolean {
  return predicted.kind === observed.kind && deepEqual(predicted.before, observed.before) && deepEqual(predicted.after, observed.after);
}

/**
 * `reconcile()` -- the mechanical predicted-vs-observed diff, plan §A.3.
 * Deliberately mechanical, not judged: every branch below is a total,
 * deterministic function of its two inputs, with no heuristic, no
 * scoring, and no reliance on call order.
 *
 * === DELTA MATCHING: BY `path`, NOT BY ARRAY POSITION =====================
 * Predicted and observed `Delta[]`s can legitimately arrive in different
 * orders -- `project()` (M3) and the real snapshot-diff step that derives
 * `ObservedEffect` (M6) have no reason to visit a `World.data` object's
 * fields in the same order as each other, and JS object key order is an
 * implementation detail neither side should be forced to replicate. This
 * function matches deltas by `path` (see `indexByPath` above), which
 * directly answers one of this milestone's named design questions: "what
 * if order differs but content is identical -- confirmed or drifted?" --
 * CONFIRMED. Order is not part of what this system claims to predict; the
 * SET of changed paths and their values is.
 *
 * REJECTED ALTERNATIVE: match by array position (`predicted[i]` vs
 * `observed[i]`). Rejected outright: it would make `reconcile()` report a
 * spurious `drifted`/`unprojected` result for two semantically identical
 * diffs that merely enumerate their paths in a different order -- a false
 * positive baked into the matching strategy itself, in a system whose
 * entire value proposition is that a divergence it reports is real.
 *
 * === WHAT ABOUT A PREDICTED PATH WITH NO OBSERVED COUNTERPART? ============
 * Plan §A.3 names three cases by example (identical deltas -> confirmed; a
 * mismatched field -> drifted; an observed-only delta -> unprojected) but
 * does not name this fourth shape: `project()` predicted a change at some
 * `path`, and the real execution's before/after diff has NO entry there
 * at all -- i.e., that field did not actually change. This is not
 * `unprojected` (nothing unpredicted happened) and it is not silently
 * `confirmed` either (something WAS predicted, and it did not occur).
 * `Reconciliation` is frozen at exactly three variants (this milestone's
 * scope explicitly excludes touching `lib/contracts`), so there is no
 * fourth status to report it under -- it is classified as `drifted`,
 * with a SYNTHESIZED `actual` delta: `{ path, before: predicted.before,
 * after: predicted.before, kind: "set" }`. This is a genuinely constructed
 * value, not something literally observed, but it is derivable with
 * certainty rather than guessed: `ObservedEffect` is defined (plan §A.3
 * step 3) as a diff between two real snapshots, so the ABSENCE of an
 * entry at a path is itself the fact that the value at that path did not
 * change -- and the pre-execution value at that path is already known,
 * because it is `predicted.before` (the projection ran against that same
 * real, pre-execution `World`, plan §A.3 step 1). `kind: "set"` is used
 * for the synthesized delta because "no change occurred" has no natural
 * home in `increment`/`remove`/`append`'s asymmetric semantics, and `set`
 * is this vocabulary's own "replace wholesale" case -- replacing a value
 * with itself is the most literal way to express "nothing moved."
 *
 * === MULTIPLE DELTAS DRIFTING (OR GOING UNPROJECTED) AT ONCE ==============
 * `Reconciliation.drifted` carries exactly ONE `expected`/`actual` pair,
 * and `.unprojected` carries exactly ONE `actual` -- the frozen type has
 * no room for "these three fields all drifted." When more than one path
 * has a problem, this function picks ONE to report, deterministically,
 * rather than arbitrarily: candidates are considered in ascending
 * lexicographic order of `path`, and any drift-class mismatch (a shared
 * path whose deltas disagree, or a "vanished" prediction per the previous
 * section) is reported before any `unprojected` extra delta, even if an
 * unprojected delta would sort earlier by path. This is a real,
 * deliberate priority choice, not a coincidence of loop order: a drift is
 * evidence the simulator was CONFIDENTLY WRONG about a path it claimed to
 * understand, which this project treats as the more actionable signal
 * than "something extra happened that nothing was claimed about" -- and
 * `SimulatorTrust` (trust.ts) does not care which of the two non-
 * `confirmed` statuses it was told about, so this priority choice only
 * affects WHICH single fact a caller sees on screen, never whether the
 * trust counter advances. STATED LIMITATION, not hidden: a caller that
 * needs to see every drifted/unprojected path in one execution, not just
 * the first, must call `reconcile()` per-path itself (e.g. by slicing the
 * two `Delta[]`s) -- this function reports one fact per call, because
 * that is all the frozen `Reconciliation` type can carry.
 *
 * === IS RECONCILE() TOTAL? =================================================
 * Yes, for every pair of WELL-FORMED inputs -- a `Delta[]` with at most
 * one entry per `path`, on each side independently (nothing requires the
 * two sides to share paths). Every such pair produces exactly one of the
 * three `Reconciliation` variants; there is no input shape in that
 * well-formed space this function fails to classify. Over MALFORMED input
 * (a duplicate `path` within one side), `reconcile()` is deliberately
 * PARTIAL: it throws `MalformedDeltaArrayError` rather than guessing which
 * of two same-path Deltas is authoritative. "Fail closed" here means
 * refusing to produce ANY `Reconciliation` value at all for that input,
 * rather than returning a plausible-looking one built on an arbitrary
 * pick -- because a `Reconciliation` this function invented a tiebreak
 * for would look identical, to every downstream caller, to one earned by
 * an honest diff, and this project's whole falsifiability story (plan
 * §0.3) depends on that never being true.
 */
export function reconcile(predicted: ReadonlyArray<Delta>, observed: ObservedEffect): Reconciliation {
  const predictedByPath = indexByPath(predicted, "predicted");
  const observedByPath = indexByPath(observed, "observed");

  const allPaths = new Set<string>([...predictedByPath.keys(), ...observedByPath.keys()]);
  const sortedPaths = [...allPaths].sort();

  // Pass 1: any drift-class mismatch, first by sorted path -- see header
  // for why drift outranks "unprojected" when both exist in one call.
  for (const path of sortedPaths) {
    const predictedDelta = predictedByPath.get(path);
    const observedDelta = observedByPath.get(path);

    if (predictedDelta !== undefined && observedDelta !== undefined) {
      if (!deltasMatch(predictedDelta, observedDelta)) {
        return { status: "drifted", expected: predictedDelta, actual: observedDelta };
      }
      continue;
    }

    if (predictedDelta !== undefined && observedDelta === undefined) {
      // "Vanished" prediction -- see header's dedicated section.
      const vanished: Delta = { path, before: predictedDelta.before, after: predictedDelta.before, kind: "set" };
      return { status: "drifted", expected: predictedDelta, actual: vanished };
    }
  }

  // Pass 2: no drift anywhere -- any observed delta the projection never
  // named at all, first by sorted path.
  for (const path of sortedPaths) {
    const observedDelta = observedByPath.get(path);
    const predictedDelta = predictedByPath.get(path);
    if (observedDelta !== undefined && predictedDelta === undefined) {
      return { status: "unprojected", actual: observedDelta };
    }
  }

  // Every predicted delta had a matching observed one, hash-for-hash
  // (deltasMatch), and nothing observed was left unaccounted for. `matched`
  // is returned in the ORIGINAL predicted order (not the sorted-path scan
  // order above), matching `reconciliation.ts`'s own doc comment: "the
  // deltas that agreed," presented the way the projection stated them.
  return { status: "confirmed", matched: predicted };
}
