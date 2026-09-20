/**
 * Dot-path get/set over a plain data tree, and a small structural
 * `deepEqual` — the two primitives `applyDeltas` (apply-deltas.ts) is built
 * from. This file is engine-owned, like every other file under
 * `lib/rollback/**` (M5's freeze boundary), and it is deliberately its own
 * small module rather than folded into `apply-deltas.ts` so the path
 * arithmetic and the interpreter's step-by-step/atomicity logic can be
 * read (and tested) separately.
 *
 * KNOWN, NAMED DUPLICATION — not accidental, not hidden. M3's own
 * `lib/simulate/path.ts` independently implements forward-delta-application
 * logic that overlaps with what this file does, and M3's own notes flag it
 * as a duplicate of logic M5 was always meant to own canonically (plan
 * §A.4: "the exact same generic interpreter M3/M4 use to apply deltas
 * forward"). This file is that canonical version. M3 has since merged and
 * `lib/simulate/path.ts` IS present on this worktree — resolving the
 * duplication (M3 importing from here, or from a shared location) remains
 * unresolved, but is left for whichever loop takes it on, not this one;
 * `lib/simulate/**` is a different milestone's frozen boundary and is not
 * touched from here. See `.genesis/decisions/0004-rollback.md` for the full
 * note.
 *
 * WHY `Delta.before`/`after` ARE TREATED AS WHOLE-VALUE SNAPSHOTS AT
 * `path`, FOR ALL FOUR `Delta.kind` VALUES — THE ONE DESIGN DECISION THIS
 * FILE IS BUILT AROUND. `delta.ts` (frozen, M1) describes `append`'s
 * inverse as "a remove of the same value" and `remove`'s inverse as "a set
 * reintroducing before," phrasing that could be read as "before/after hold
 * a single collection ELEMENT." That reading was considered and rejected:
 * a single-element model needs to know WHICH occurrence to remove when a
 * collection has duplicate values, and WHERE an appended element landed —
 * exactly the ambiguity named in this milestone's own design questions,
 * and exactly the kind of "bigger vocabulary the interpreter must
 * understand" `Delta.kind`'s own doc comment already rejected once
 * (deliberately no JSON-Patch-style move/copy/test operators). Treating
 * `before`/`after` as the FULL value found at `path` immediately before
 * and immediately after the change sidesteps the ambiguity completely:
 * there is no "which occurrence" question, because the exact resulting
 * snapshot is what got recorded, not a description of the edit that
 * produced it. Applying ANY `Delta` — regardless of `kind` — becomes one
 * uniform rule: "verify the current value at `path` deep-equals `before`,
 * then replace it with `after`." `kind` therefore never needs to be
 * inspected by this file or by `apply-deltas.ts` at all; it exists purely
 * for `invertDelta` (which DOES branch on it, to choose a semantically
 * honest relabeling — see `invert-delta.ts`) and for M4's reconciliation
 * (recognizing "additive" vs "overwrite" drift, per `delta.ts`'s own
 * stated rationale — out of this milestone's scope).
 *
 * ACCEPTED COST of this choice, named rather than hidden: a `Delta` for a
 * large collection's `append`/`remove` carries the WHOLE collection twice
 * (once as `before`, once as `after`), not just the changed element. For
 * this project's four domains (an outbox, a participant list, a
 * reservation map) this is cheap; it would not scale to an unbounded
 * collection, and this file does not pretend otherwise.
 *
 * SCOPE, NAMED: `path` is dot-separated and may address either a plain
 * object key or a numeric array index at each segment (`"stock.reserved"`,
 * `"items.0.qty"`). Deleting an object KEY (via `setAtPath` with
 * `value === undefined`) is fully supported and is how `remove`'s forward
 * application and `append`'s inverse both behave when the field did not
 * exist before. Deleting a numeric ARRAY INDEX is deliberately NOT
 * specially handled — `setAtPath` on an array index with `value ===
 * undefined` writes a hole (`arr[i] = undefined`), it does not splice and
 * shift later indices. None of this project's four domains (plan §D)
 * remove a single array element by index; every collection change in this
 * project's demo is expressed as a whole-array `before`/`after` snapshot
 * on the collection's OWN field (see the file header above), so this is a
 * documented scope limit, not a silent gap — a domain that genuinely needs
 * index-level array splicing is expressing something this file's model
 * does not cover, and should say so rather than get a silently wrong
 * answer.
 */

/** Splits a dot-path into its segments. `""` (the empty path) is rejected by both `getAtPath`/`setAtPath` callers' shared assumption that every `Delta.path` names at least one segment — `delta.test.ts` (M1, frozen) already exercises `path` as a non-empty string. */
function segments(path: string): readonly string[] {
  return path.split(".");
}

/**
 * Reads the value at `path` inside `root`. Returns `undefined` the moment
 * any segment is missing — including the case where `root` itself is
 * `undefined` or `null` partway down the walk — which is exactly the
 * "absent" reading `setAtPath`'s delete behavior (below) produces. Never
 * throws on a missing path; a missing path and an explicitly-`undefined`
 * value are indistinguishable here, matching ordinary JavaScript property
 * access (`obj.missing === undefined`) rather than inventing a separate
 * "not found" signal this codebase has no other use for.
 */
export function getAtPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const key of segments(path)) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Writes `value` at `path` inside `root`, MUTATING `root` in place and
 * returning it — this function is intentionally destructive. It is only
 * ever called by `apply-deltas.ts` against a fresh, private working copy
 * (`structuredClone` of a `World.data`, never the frozen original), so the
 * mutation is safe and contained; see that file's header for why mutating
 * a scratch copy, then freezing only the finished result, is the chosen
 * design rather than a purely functional path-set that reallocates a new
 * tree per step.
 *
 * Creates intermediate plain objects for any missing segment before the
 * last one (so setting `"a.b.c"` on `{}` produces `{ a: { b: { c: value }
 * } }`), EXCEPT when `value === undefined`, in which case a missing
 * intermediate segment means there is nothing to delete and this function
 * returns without creating anything — deleting something that was already
 * absent is a no-op, not an error, matching `delete obj.missing` semantics.
 *
 * `value === undefined` at the FINAL segment deletes that key from its
 * parent object (`delete parent[key]`) rather than setting it to
 * `undefined` — see the file header's "WHY... WHOLE-VALUE SNAPSHOTS"
 * section: `remove`'s forward application (deleting a field entirely) and
 * `append`'s inverse (undoing the very first append to a field that did
 * not exist before) both rely on this to actually remove the key, not
 * leave a `key: undefined` residue that `JSON.stringify` and
 * `Object.keys` would treat differently from a genuinely absent key.
 */
export function setAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const keys = segments(path);
  let current: Record<string, unknown> = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i] as string;
    const next = current[key];
    if (next === null || next === undefined || typeof next !== "object") {
      if (value === undefined) return; // Deleting something whose parent doesn't exist: nothing to do.
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
    } else {
      current = next as Record<string, unknown>;
    }
  }
  const lastKey = keys[keys.length - 1] as string;
  if (value === undefined) {
    delete current[lastKey];
  } else {
    current[lastKey] = value;
  }
}

/**
 * Structural equality over the `unknown` values `Delta.before`/`after`
 * actually hold (see `delta.ts`'s own note that these are deliberately
 * `unknown`, not `Json` — this function is intentionally a little more
 * permissive than a `Json`-only deep-equal would need to be, e.g. it
 * must agree that two `undefined`s are equal for the "field is absent"
 * case above).
 *
 * Uses `Object.is` for the primitive/leaf comparison rather than `===`
 * for exactly one reason: `Object.is(NaN, NaN)` is `true` where `NaN ===
 * NaN` is `false`. `applyDeltas`'s per-step verification (apply-
 * deltas.ts) compares a recorded `before` against the real current value
 * with this function, and a domain whose real data legitimately contains
 * `NaN` (a `Json` `number` is not restricted to finite values) must not
 * have every rollback step against it spuriously fail a verification that
 * is, in fact, correct. `Object.is` also distinguishes `+0`/`-0`, which
 * `===` does not — accepted as harmless over-strictness here (this
 * project's domains have no `-0`-vs-`+0`-sensitive state), not chosen for
 * that property specifically.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;

  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr !== bArr) return false;

  if (aArr && bArr) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}
