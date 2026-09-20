import type { Json } from "../contracts/index.js";

/**
 * Dot-path navigation over a `Json` tree — `getAtPath`/`setAtPath`/
 * `deleteAtPath` — the primitives `consistency.ts` needs to actually apply
 * a `Delta` array to `World.data` and check the result, rather than take
 * an adapter's claimed `resultingFingerprint` on faith (see consistency.ts
 * for the self-consistency check these primitives make possible).
 *
 * WHY THIS FILE EXISTS AT ALL, GIVEN M5 OWNS "THE" `applyDeltas` — a
 * duplication risk named honestly, not hidden. `sim-plan.md` §A.4 assigns
 * "the one generic `applyDeltas` interpreter" to `lib/rollback/**`,
 * engine-owned, a LATER freeze boundary (M5) that does not exist yet. Its
 * job is bigger than this file's: it takes a whole `World<TState>` and a
 * `Delta[]`, and must produce a whole new `World` (bumping whatever
 * `version`/`at` semantics M5 decides on, not just `data`). This file's
 * job is narrower and comes first out of necessity, not preference:
 * `simulate()` (M3) needs to check whether an adapter's OWN claimed
 * `deltas` actually produce its OWN claimed `resultingFingerprint` — a
 * question about one `ProjectedEffect`'s internal consistency, answerable
 * from `Json` data alone, with no `World` metadata involved. Building that
 * check requires *some* forward-delta-application logic to exist before
 * M5 does. Two honest paths were available: (a) skip the self-consistency
 * check entirely and defer it to M4/M5, or (b) write the narrow slice this
 * milestone actually needs and name the overlap plainly. (b) was chosen —
 * see `.genesis/decisions/0002-simulate.md` for the full argument — because
 * the check this buys (§A.2's strongest answer to "it's just guessing")
 * is cheap, real, and worth having now rather than three milestones later.
 * FORWARD NOTE FOR M5, recorded here for the same reason ADR 0001 left one
 * for this milestone: when `lib/rollback/**`'s `applyDeltas` exists, it
 * should either import these path primitives (if a whole-`World` shape can
 * be built on top of a `Json`-level `get`/`set`/`delete`) or supersede them
 * outright — this file's function is deliberately NOT exported from
 * `lib/simulate`'s public barrel (see `index.ts`) specifically so it stays
 * an internal implementation detail M5 is free to ignore, replace, or
 * subsume without that being a breaking change to anything outside this
 * directory.
 *
 * SCOPE, STATED PLAINLY: path segments are plain object keys joined by
 * `.` (e.g. `"stock.reserved"`) — matching every real example in
 * `sim-plan.md` and `lib/contracts/**`'s own tests. There is no bracket/
 * array-index syntax (`"items[3]"`) because no domain in this plan's §D
 * needs one: the "collection" cases (append to an outbox, add a
 * participant) are modeled as a NEW named key appearing at an exact path
 * (see `consistency.ts`'s header for the full "append creates a leaf that
 * didn't exist before" argument), not as a numeric index into an array —
 * so this file never needs to address "the third element of this array"
 * at all. Adding array-index segments would be exactly the kind of
 * "expression language nobody asked for" ADR 0001 already declined to
 * build for `Delta.kind` itself.
 *
 * THIS ASSUMPTION IS SHARED WITH `consistency.ts`, NOT UNIQUE TO THIS
 * FILE — a forward note added after independent verification flagged
 * that only THIS file's header named it. The "no array-index syntax,
 * `\"append\"` creates a leaf that did not exist before" assumption is
 * load-bearing in TWO places: this file's own `setAtPath`/`deleteAtPath`,
 * AND `consistency.ts`'s Layer-1 `"append"` handling (`checkClaimedBefore`
 * there treats "the path already has a value" as a contradiction of
 * `"append"`'s own claimed shape). A future milestone reopening this
 * assumption — to add array-index paths, or to model a collection as a
 * single array field appended-to rather than as one new key per item —
 * must update BOTH files together, or `consistency.ts` will keep
 * enforcing a rule `path.ts` no longer actually implements. See
 * `consistency.ts`'s own header for the matching cross-reference.
 */

function splitPath(path: string): readonly string[] {
  return path.split(".");
}

/** True if `value` is a plain object (not an array, not null) — the only container `getAtPath`/`setAtPath`/`deleteAtPath` ever descend into, per this file's "object keys only" scope. */
function isPlainObject(value: Json): value is { readonly [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Reads the value at `path` inside `data`, or `undefined` if any segment
 * along the way is missing (an absent leaf — the expected shape for a
 * `Delta` that is about to `append`/create it — or a missing intermediate
 * object, which `consistency.ts` treats as "nothing here," not as a
 * thrown error: distinguishing "absent" from "present but null" is exactly
 * what lets the per-delta `before` check tell an honest "append" apart
 * from a domain lying about a path that already existed).
 */
export function getAtPath(data: Json, path: string): Json | undefined {
  let cursor: Json = data;
  for (const segment of splitPath(path)) {
    if (!isPlainObject(cursor)) return undefined;
    if (!Object.hasOwn(cursor, segment)) return undefined;
    cursor = cursor[segment] as Json;
  }
  return cursor;
}

/** Thrown by `setAtPath`/`deleteAtPath` when a path cannot be resolved because an intermediate segment exists but is not a plain object (e.g. `"a.b"` where `data.a` is already a number) — a shape a well-formed `Delta` should never produce against a self-consistent `World`, and therefore a signal `consistency.ts` treats as "this effect is malformed," not a bug in this file. */
export class PathResolutionError extends Error {
  constructor(path: string, reason: string) {
    super(`cannot resolve path "${path}": ${reason}`);
    this.name = "PathResolutionError";
  }
}

/**
 * Returns a NEW tree with the value at `path` set to `nextValue`, creating
 * any missing intermediate plain objects along the way (the "append
 * creates a leaf" case — see file header) — WITHOUT mutating `data` or any
 * of its nested values. Structural sharing: every object NOT on the path
 * from the root to the target leaf is reused by reference in the result,
 * not deep-cloned, because `data` (and everything reachable from it) is
 * already deep-frozen by the time this runs (`simulate.ts` calls
 * `deepFreezeClone` before any of this) and an unmodified subtree is safe
 * to share — only the ancestors actually being replaced need a fresh,
 * unfrozen object built for them.
 *
 * This does NOT rely on `data` being frozen to guarantee non-mutation: it
 * is written to never assign into an existing object in the first place
 * (every ancestor on the path is copied into a new object before its
 * changed child is set on the copy). Freezing is defense in depth here,
 * not the primary guarantee — the same "runtime guarantee, not merely a
 * happy accident of the input already being locked" standard `world.ts`
 * holds `deepFreezeClone` itself to.
 */
export function setAtPath(data: Json, path: string, nextValue: Json): Json {
  const segments = splitPath(path);
  return setAtSegments(data, segments, nextValue, path);
}

function setAtSegments(node: Json, segments: readonly string[], nextValue: Json, fullPath: string): Json {
  const [head, ...rest] = segments;
  if (head === undefined) return nextValue; // consumed every segment: this IS the target leaf.

  if (node !== null && typeof node === "object" && !isPlainObject(node)) {
    throw new PathResolutionError(fullPath, `segment "${head}" expects a plain object, found an array`);
  }
  const container = isPlainObject(node) ? node : {}; // missing intermediate: create it, per file header.
  const child = Object.hasOwn(container, head) ? (container[head] as Json) : undefined;
  const nextChild = setAtSegments(child ?? null, rest, nextValue, fullPath);

  return { ...container, [head]: nextChild };
}

/**
 * Returns a NEW tree with the key at `path` deleted entirely (not set to
 * `null`/`undefined` — an actually-absent key, matching `Delta.kind ===
 * "remove"`'s semantics: "delete a value at path," `delta.ts`). If any
 * segment along the way is already missing, returns `data` unchanged
 * (idempotent) rather than throwing — `consistency.ts`'s per-delta
 * `before` check is what catches "this domain claimed to remove something
 * that wasn't there," not this function; this function's own job is only
 * to perform the deletion honestly when asked, structural-sharing the
 * same way `setAtPath` does.
 */
export function deleteAtPath(data: Json, path: string): Json {
  const segments = splitPath(path);
  return deleteAtSegments(data, segments, path);
}

function deleteAtSegments(node: Json, segments: readonly string[], fullPath: string): Json {
  const [head, ...rest] = segments;
  if (head === undefined) return node; // nothing to delete with zero segments left; unreachable via deleteAtPath's own public call shape, guarded anyway.
  if (!isPlainObject(node)) return node; // missing intermediate: nothing to delete, unchanged (see doc comment).
  if (!Object.hasOwn(node, head)) return node;

  if (rest.length === 0) {
    const { [head]: _removed, ...remainder } = node;
    return remainder;
  }
  const child = node[head] as Json;
  const nextChild = deleteAtSegments(child, rest, fullPath);
  return { ...node, [head]: nextChild };
}
