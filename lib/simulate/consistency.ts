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
 *   - For `"append"`: the SAME deep-equal-`delta.before` rule applies,
 *     with no special case — see "REOPENED" below for why this file used
 *     to require the path to start `undefined` here, and why that turned
 *     out to be wrong. `current` MAY legitimately be `undefined` for an
 *     `append` (a genuinely fresh leaf, matching `delta.before: undefined`)
 *     or may legitimately be a real, already-populated value (growing an
 *     existing collection, matching `delta.before` against that whole
 *     collection) — both are honest `append`s under ADR 0004's model, and
 *     both are checked the identical way every other `kind` already is:
 *     does the real current value deep-equal what the delta claims it
 *     was.
 *
 * REOPENED (post-M6 integration finding, verified before being adopted —
 * see the PR that carries this comment for the confirmation): this file
 * ORIGINALLY required an `append` delta's path to be currently
 * `undefined`, unconditionally, reading `delta.ts`'s prose ("add a value
 * to a collection at path") as "the path itself is the new leaf being
 * created." `.genesis/decisions/0004-rollback.md` (M5, written and
 * accepted AFTER this file) Decision 1 settled the question the other
 * way, canonically, for the whole codebase: `Delta.before`/`after` are
 * WHOLE-VALUE SNAPSHOTS at `path` for all four `kind`s, so a real
 * `append` to an already-populated array has a non-`undefined` `before`
 * — the exact opposite of what this file required. `apply-deltas.ts` and
 * `invert-delta.ts` (`lib/rollback/**`) were already built on that
 * convention; this file's old `append`-must-start-`undefined` rule
 * predated it and was the one file in the codebase still enforcing the
 * rejected reading. M6's `domains/shared/grow.ts` had to work around this
 * file's old behavior with a two-step `remove`-then-`append` pair for
 * every array-growing domain, purely to satisfy a rule this file no
 * longer applies — see that file's own header, which is not rewritten
 * here (`domains/**` is a separate freeze boundary) but is now stale in
 * the specific sense that the workaround it describes is no longer
 * required by THIS file (whether to remove it is the orchestrator's
 * call, not this one). THE FIX ITSELF IS NARROW: `checkClaimedBefore`
 * below no longer branches on `delta.kind` at all before comparing
 * `current` to `delta.before` — `kind` was already inert to how a delta
 * is APPLIED (`applyOneDelta` below never inspected it either); this
 * removes the one place it was still inspected for VALIDATION, bringing
 * this file in line with every other consumer of `Delta` in this
 * codebase.
 *
 * NAMED GAP LEFT BY THE REOPENING (found by independent verification
 * while reviewing the reopening above), NOW PARTIALLY CLOSED, PARTIALLY
 * DISCLOSED — the two are not the same thing and this file does not
 * blur them: dropping the `append`-must-start-`undefined` rule means
 * `checkClaimedBefore` no longer checks anything about the RELATIONSHIP
 * between `before` and `after` for an `append` on its own — only that
 * `before` is honest. `checkAppendGrowth` (below) now enforces exactly
 * ONE narrow, well-evidenced slice of that relationship; everything
 * outside that slice remains genuinely unchecked, named explicitly so a
 * future reader does not have to rediscover which is which.
 *
 * ENFORCED (verified against every real call site before being adopted
 * — see the PR that carries this comment for the confirmation): when
 * `delta.kind === "append"` AND `delta.before` is a real, defined
 * ARRAY, `delta.after` must ALSO be an array with AT LEAST as many
 * elements. A first version of this disclosure justified doing nothing
 * by citing this file's own remove-then-append example and
 * `domains/infra/domain.ts`'s multi-step `desiredCount` pipeline as
 * cases a growth check would wrongly reject — independent verification
 * checked both against the real code and found neither supports that:
 * `domains/shared/grow.ts`'s `growArraySteps` (every real array-growing
 * domain's actual `append` step) is ALWAYS `{ before: undefined, after:
 * fullArray }` — fresh-leaf creation, never a `before`-is-a-defined-
 * array shrink — and `desiredCount`'s pipeline uses `kind: "set"`, not
 * `"append"`, so it was never actually a counter-example for THIS
 * `kind` at all, only an analogy. A rule scoped to "`before` is a
 * defined array, `after` must not have fewer elements" fires on NEITHER
 * cited case and changes nothing `domains/**` currently does —
 * `npm run demo:domains` staying 7/7 with this check live is the direct
 * proof, not an assumption.
 *
 *     checkConsistency({ items: ["a","b","c"] }, { deltas: [{ path:
 *     "items", before: ["a","b","c"], after: ["a","b"], kind: "append"
 *     }], ... }) // → { ok: false } (was `{ ok: true }` before this check)
 *
 * STILL GENUINELY DISCLOSED, NOT ENFORCED, AND THE REMAINING REASONS ARE
 * NARROWER THAN THE FIRST VERSION OF THIS PARAGRAPH CLAIMED (they now
 * justify NOT GENERALIZING further, not doing nothing):
 *
 *   1. A SAME-LENGTH OR LONGER, BUT UNRELATED, REPLACEMENT still passes
 *      — `{ before: ["a","b"], after: ["x","y","z"] }` is "growth" by
 *      length alone and is accepted, even though it is not really an
 *      append of anything from `before`. Catching this needs a real
 *      notion of "is `after` a superset/extension of `before`," which
 *      this file does not attempt — that would be inventing a bespoke,
 *      order-and-duplicate-sensitive comparison this codebase has never
 *      needed before, for a case no real domain in this milestone
 *      produces.
 *   2. NON-ARRAY `append` TARGETS are entirely outside this check's
 *      scope, on purpose: `delta.ts` never restricts `append`'s payload
 *      to arrays, and `before`/`after` are `unknown` by design — a
 *      generic "growth" notion for an object- or scalar-valued `append`
 *      has no obvious single definition, and inventing one would be
 *      exactly the kind of per-shape heuristic Layer 1's honesty check
 *      has never made for any other `kind`. (When `delta.before` is
 *      `undefined` — the fresh-leaf case, and every real `domains/**`
 *      append today — this check does not apply at all, by the same
 *      "defined array" precondition.)
 *   3. Precedent, in this exact file: `effect-validation.ts`'s
 *      `increment` check enforces "numeric," never "increasing" —
 *      `after < before` is explicitly, deliberately accepted as "a
 *      legitimate decrement" per `delta.ts`'s "signed" wording. The
 *      growth check above does not extend past arrays for the same
 *      reason that precedent does not extend past numeric coherence:
 *      verify structural honesty and the one type constraint that is
 *      actually well-defined, never invent a broader semantic rule
 *      `delta.ts` itself never committed to.
 *
 * A future milestone that wants MORE than the narrow slice enforced here
 * — same-length unrelated replacement, or any notion of growth for a
 * non-array `append` target — has a real, well-scoped question to
 * answer first (what does "growth" mean for that shape, checked at what
 * granularity), not a bug to patch silently into this function.
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

/**
 * Layer 1 for one delta — see file header. Returns a problem string, or
 * `undefined` if `delta.before` is honest. `deepEqualJson` is used rather
 * than `===` because `before`/`after` are `unknown` (delta.ts) and a
 * domain's real state is routinely object/array-shaped, not just
 * primitives.
 *
 * NO BRANCH ON `delta.kind` HERE (see file header's "REOPENED" note for
 * why an `append`-specific branch used to exist and why it was removed):
 * `"set" | "increment" | "remove"` require the path to already hold a
 * value (`current !== undefined`) before comparing it — that assumption
 * is real, still enforced, and NOT part of this reopening. `"append"` is
 * the one `kind` that may legitimately start from a truly absent path
 * (`current === undefined`, matching `delta.before: undefined` — a fresh
 * leaf) as well as an already-populated one (growing an existing
 * collection) — so it skips straight to the `deepEqualJson` comparison,
 * which already handles BOTH `current === undefined` (via `a === b` in
 * `deepEqualJson`, since `undefined === undefined`) and a real populated
 * value, with no separate case needed.
 *
 * ONE ADDITIONAL CHECK FOR `"append"`, ONLY REACHED ONCE `before` ITSELF
 * IS ALREADY CONFIRMED HONEST (see `checkAppendGrowth` below and the file
 * header's "ENFORCED"/"STILL GENUINELY DISCLOSED" paragraphs for exactly
 * what this does and does not cover): checking growth against a
 * `before` that has not yet been verified against `current` would be
 * checking the delta's story against itself, not against the world —
 * this file's Layer 1 has never done that for any other rule.
 */
function checkClaimedBefore(delta: Delta, current: Json | undefined, index: number): ConsistencyProblem | undefined {
  if (delta.kind !== "append" && current === undefined) {
    return `deltas[${index}] (kind "${delta.kind}") claims path "${delta.path}" already had a value, but nothing exists there in the input World.data`;
  }
  if (!deepEqualJson(current as Json, delta.before as Json)) {
    return (
      `deltas[${index}] claims path "${delta.path}" started at ${JSON.stringify(delta.before)}, ` +
      `but the input World.data actually has ${JSON.stringify(current)} there`
    );
  }
  if (delta.kind === "append") {
    const growthProblem = checkAppendGrowth(delta, index);
    if (growthProblem !== undefined) return growthProblem;
  }
  return undefined;
}

/**
 * The one narrow slice of "does `append` actually grow the collection"
 * this file enforces — see the file header's "ENFORCED" paragraph for
 * the evidence this was checked against before being adopted. Applies
 * ONLY when `delta.before` is a real, defined ARRAY (a fresh-leaf
 * `append`, where `before` is `undefined`, is exempt by construction —
 * there is nothing to shrink FROM); when it applies, `delta.after` must
 * ALSO be an array with at least as many elements. A non-array `after`
 * is treated as the most extreme case of "fewer elements" (there being
 * none), not a separate rule.
 */
function checkAppendGrowth(delta: Delta, index: number): ConsistencyProblem | undefined {
  if (!Array.isArray(delta.before)) return undefined;
  const afterLength = Array.isArray(delta.after) ? delta.after.length : -1;
  if (afterLength >= delta.before.length) return undefined;
  return (
    `deltas[${index}] claims "append" at path "${delta.path}", but after (${JSON.stringify(delta.after)}) does not ` +
    `represent growth over before (${JSON.stringify(delta.before)}) — an append targeting an existing array must ` +
    `not shrink it`
  );
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
