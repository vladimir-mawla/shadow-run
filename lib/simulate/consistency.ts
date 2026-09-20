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
 * NAMED GAP LEFT BY THE REOPENING, DISCLOSED RATHER THAN CLOSED (found by
 * independent verification while reviewing the reopening above): dropping
 * the `append`-must-start-`undefined` rule means `checkClaimedBefore` no
 * longer checks anything about the RELATIONSHIP between `before` and
 * `after` for an `append` — only that `before` is honest. An `append`
 * whose `after` actually SHRINKS the collection, is a NO-OP, or is a
 * wholesale unrelated replacement still passes, as long as `before`
 * matches:
 *
 *     checkConsistency({ items: ["a","b","c"] }, { deltas: [{ path:
 *     "items", before: ["a","b","c"], after: ["a","b"], kind: "append"
 *     }], ... }) // → { ok: true }
 *
 * even though `after` has FEWER elements than `before` — the opposite of
 * what "append" means in `delta.ts`'s own prose ("add a value to a
 * collection"). Under the OLD rule this specific case happened to be
 * unreachable (an append could only ever start from `undefined`, so
 * "shrink relative to before" had no `before` to shrink FROM) — it is a
 * gap the reopening WIDENS the reach of, not one it introduces from
 * nothing, and it is disclosed here rather than silently left for a
 * future reader to rediscover.
 *
 * DELIBERATELY NOT CHECKED, FOR THE SAME REASON `effect-validation.ts`'s
 * `increment` coherence check deliberately does NOT check the SIGN of an
 * increment's change (see that file's header): checking "did this kind's
 * `before`/`after` move in the direction its label implies" is a
 * DIRECTIONAL/semantic claim about `kind`, not a STRUCTURAL claim about
 * whether `before` is honest — and this file's Layer 1 has only ever been
 * the latter. Three concrete reasons a growth check is not added here,
 * not just one:
 *
 *   1. "Growth" has no well-defined generic meaning across `unknown`
 *      JSON values. It is intuitive for an array (`after.length >
 *      before.length`?), but `delta.ts` never restricts `append`'s
 *      payload to arrays specifically — `before`/`after` are `unknown`
 *      by design (this file's own `deepEqualJson` handles objects and
 *      primitives too) — so any rule would either silently assume
 *      "arrays only" (quietly narrowing what `append` is allowed to
 *      describe, a bigger reopening than this one) or need its own
 *      per-shape heuristics, which is exactly the kind of judgment call
 *      Layer 1's honesty check has never made for any other `kind`.
 *   2. A single delta's local `before`/`after` cannot be judged in
 *      isolation against "the whole effect's" intent — this file's OWN
 *      multi-delta example two paragraphs below (`remove` at `"a.b"`
 *      followed by an `append` recreating `"a.b.c"`) is proof that one
 *      step's `after` legitimately looking like a regression is
 *      sometimes exactly what a correct multi-step pipeline produces at
 *      an intermediate point; `domains/infra/domain.ts`'s own multi-step
 *      `desiredCount` pipeline (drained then restored, across `"set"`
 *      deltas) is the same principle for a different `kind`. A rule that
 *      judges one delta's shape without the surrounding effect would risk
 *      rejecting exactly the multi-step case ADR 0004's own header already
 *      treats as legitimate.
 *   3. Precedent, in this exact file: `effect-validation.ts`'s `increment`
 *      check enforces "numeric," never "increasing" — `after < before` is
 *      explicitly, deliberately accepted as "a legitimate decrement" per
 *      `delta.ts`'s "signed" wording. The same philosophy — verify
 *      structural honesty and (where `delta.ts` names a real type
 *      constraint) type coherence, never a `kind`-implied DIRECTION —
 *      applies here without inventing a new standard just for `append`.
 *
 * A future milestone that wants "append never shrinks" as an enforced
 * property has a real, well-scoped question to answer first — what
 * counts as growth for a non-array `append` target, and at what
 * granularity (one delta, or the whole effect) — not a bug to patch
 * silently into this function.
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
