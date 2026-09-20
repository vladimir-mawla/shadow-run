import { computeFingerprint, type Delta, type Json, type ProjectedEffect } from "../contracts/index.js";
import { deleteAtPath, getAtPath, PathResolutionError, setAtPath } from "./path.js";

/**
 * THE SINGLE MOST IMPORTANT FILE IN THIS MILESTONE'S ANSWER TO "you're
 * just asking a model to guess and calling it a simulation." The build
 * brief asks directly: "Can the engine verify a projection is
 * self-consistent — that applying the claimed deltas to the input world
 * actually produces the claimed `resultingFingerprint`? If it can, that is
 * a strong, cheap, structural check ... If it cannot, explain why." The
 * answer here is: **it can, and this file does it, two layers deep** —
 * see `.genesis/decisions/0002-simulate.md` for the full argument,
 * including the honest duplication-risk note about `path.ts`.
 *
 * LAYER 1 — PER-DELTA `before` CONSISTENCY. Before applying a delta, this
 * checks that its claimed `before` actually matches what is really at
 * `delta.path` in the (already-applied-so-far) working data. This catches
 * a lie a bare final-hash check alone could miss: an adapter could, in
 * principle, fabricate a `deltas` array whose individual entries are false
 * about the starting state but whose net effect still happens to hash to
 * a plausible-looking `resultingFingerprint` for some OTHER path (the two
 * checks are testing genuinely different things — "did you start from
 * where you claim you started" vs. "does your own math check out" — and a
 * value could pass one and fail the other).
 *
 *   - For `"set" | "increment" | "remove"`: the path is expected to
 *     ALREADY exist (`delta.ts`'s own semantics — these all describe a
 *     change to something already there). The value found there must
 *     deep-equal `delta.before`.
 *   - For `"append"`: the path is expected to NOT exist yet (`delta.ts`:
 *     "add a value to a collection at path" — modeled here, per this
 *     file's own reading of `invertDelta`'s mapping in `sim-plan.md` §A.4,
 *     as the path itself naming the new leaf that is being created, not
 *     an index into a pre-existing array — see `path.ts`'s file header
 *     for the full reasoning). If the path already has a value, that's a
 *     contradiction: something is already there, so this isn't actually
 *     an append. THIS ASSUMPTION IS SHARED WITH `path.ts`, NOT UNIQUE TO
 *     THIS FILE — see that file's own header for the matching
 *     cross-reference: a future reopening of "no array-index syntax,
 *     append creates a new leaf" must update `checkClaimedBefore` here
 *     AND `path.ts`'s primitives together, or the two will silently
 *     enforce different rules.
 *
 * LAYER 2 — FINAL FINGERPRINT CONSISTENCY. After applying every delta (in
 * order — order matters when two deltas touch related paths, e.g. a
 * `remove` at `"a.b"` followed by an `append` recreating `"a.b.c"`),
 * `computeFingerprint` of the resulting data must equal the effect's own
 * claimed `resultingFingerprint`. This is the literal check the build
 * brief describes: apply the deltas for real, hash the result, compare —
 * never trust the claimed hash on its own.
 *
 * WHAT THIS DOES NOT AND CANNOT PROVE, STATED PLAINLY: self-consistency is
 * necessary, not sufficient. A domain's `project()` could compute an
 * effect that is internally consistent (its deltas really do produce its
 * own claimed fingerprint, from the real input `World`) and STILL be
 * wrong about what the real execution will actually do — e.g. a
 * calendar-reschedule adapter that hand-mirrors the wrong business rule
 * consistently. That gap is exactly what M4's reconciliation (predicted
 * vs. OBSERVED, from a real post-execution `World`) exists to close — this
 * file proves the projection didn't contradict itself; it cannot and does
 * not claim to prove the projection matches reality, because nothing
 * computed before the real write runs can prove that. See
 * `.genesis/decisions/0002-simulate.md` for this exact scoping statement.
 */

export type ConsistencyProblem = string;

export interface ConsistencyResult {
  readonly ok: boolean;
  readonly problems: readonly ConsistencyProblem[];
}

/**
 * Runs both layers described in the file header against `data` (the
 * `World.data` the effect was supposedly computed from — already
 * deep-frozen by the time `simulate.ts` calls this, though this function
 * never mutates it either way; every `path.ts` primitive returns a new
 * tree) and `effect` (already shape-validated by `effect-validation.ts` —
 * this function assumes `effect.deltas` entries have the right FIELDS,
 * and checks only whether their VALUES are true).
 */
export function checkConsistency(data: Json, effect: ProjectedEffect): ConsistencyResult {
  const problems: ConsistencyProblem[] = [];
  let working: Json = data;

  effect.deltas.forEach((delta, index) => {
    const current = getAtPath(working, delta.path);
    const beforeProblem = checkClaimedBefore(delta, current, index);
    if (beforeProblem !== undefined) problems.push(beforeProblem);

    try {
      working = applyOneDelta(working, delta);
    } catch (error) {
      const reason = error instanceof PathResolutionError ? error.message : String(error);
      problems.push(`deltas[${index}] (path "${delta.path}") could not be applied: ${reason}`);
    }
  });

  if (problems.length === 0) {
    const derivedFingerprint = computeFingerprint(working);
    if (derivedFingerprint !== effect.resultingFingerprint) {
      problems.push(
        `resultingFingerprint mismatch: applying the ${effect.deltas.length} claimed delta(s) to the input World.data ` +
          `produces a fingerprint of "${derivedFingerprint}", not the claimed "${effect.resultingFingerprint}"`,
      );
    }
  }

  return { ok: problems.length === 0, problems };
}

/** Layer 1 for one delta — see file header. Returns a problem string, or `undefined` if `delta.before` is honest. `deepEqualJson` is used rather than `===` because `before`/`after` are `unknown` (delta.ts) and a domain's real state is routinely object/array-shaped, not just primitives. */
function checkClaimedBefore(delta: Delta, current: Json | undefined, index: number): ConsistencyProblem | undefined {
  if (delta.kind === "append") {
    if (current !== undefined) {
      return `deltas[${index}] claims "append" at path "${delta.path}", but a value already exists there: ${JSON.stringify(current)}`;
    }
    return undefined;
  }

  if (current === undefined) {
    return `deltas[${index}] (kind "${delta.kind}") claims path "${delta.path}" already had a value, but nothing exists there in the input World.data`;
  }
  if (!deepEqualJson(current, delta.before as Json)) {
    return (
      `deltas[${index}] claims path "${delta.path}" started at ${JSON.stringify(delta.before)}, ` +
      `but the input World.data actually has ${JSON.stringify(current)} there`
    );
  }
  return undefined;
}

/** Forward-applies one delta to `working` — see file header's reading of `Delta.kind` semantics: `"set" | "increment" | "append"` all resolve to "the leaf at `path` becomes `after`" mechanically (they differ only in what they mean for reconciliation, M4's job, per `delta.ts`'s own comment); `"remove"` deletes the leaf outright. */
function applyOneDelta(working: Json, delta: Delta): Json {
  if (delta.kind === "remove") {
    return deleteAtPath(working, delta.path);
  }
  return setAtPath(working, delta.path, delta.after as Json);
}

/** Structural equality over `Json` values — deliberately not `JSON.stringify(a) === JSON.stringify(b)` (key order would make two structurally-equal-but-differently-constructed objects compare unequal, the exact hazard `fingerprint.ts`'s `canonicalize` already exists to avoid, one layer over) and not a third hashing pass (this only needs a boolean, not another `computeFingerprint` call). */
function deepEqualJson(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((entry, index) => deepEqualJson(entry, b[index] as Json));
  }

  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key, index) => key === bKeys[index] && deepEqualJson((a as Record<string, Json>)[key] as Json, (b as Record<string, Json>)[key] as Json));
}
