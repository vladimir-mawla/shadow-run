/**
 * A small, local structural-equality check for `Delta.before`/`Delta.after`
 * — deliberately NOT reused from `lib/contracts` (there is nothing to
 * reuse: `isPlainData`/`assertPlainData` in `world.ts` answer "is this
 * value shaped like `Json`," a different question from "are these two
 * arbitrary values structurally equal"). `Delta.before`/`after` are typed
 * `unknown`, not `Json` (see `delta.ts`'s own comment on why), because a
 * `Delta` describes a change to one field already living inside an
 * already-`Json`-constrained `World.data` — but `reconcile()` receives
 * `Delta` values produced by two DIFFERENT, untrusted-to-each-other
 * sources (a domain's `project()` for the predicted side, a real
 * before/after snapshot diff for the observed side — plan §A.3), so this
 * file cannot assume either side actually honored that constraint by the
 * time it gets here. `deepEqual` is written to degrade safely rather than
 * throw if it doesn't: anything that isn't a plain primitive/array/object
 * falls through to `Object.is` reference/identity comparison (see below).
 *
 * WHY `Object.is`, NOT `===`, FOR PRIMITIVES: `Object.is(NaN, NaN)` is
 * `true` and `Object.is(-0, 0)` is `false`, both the opposite of `===`.
 * `NaN` is a realistic value a domain's counter arithmetic could produce
 * (e.g. dividing by a zero quantity) — treating two `NaN`s as "not equal"
 * would make `reconcile()` report a spurious drift for a predicted and
 * observed value that are actually the identical (non-)number, purely as
 * an artifact of this function's own comparison operator rather than a
 * real disagreement between prediction and reality. `-0` vs `0` is the
 * opposite edge: treating them as different is the more conservative,
 * defensible choice for a system whose whole purpose is noticing exactly
 * this kind of small discrepancy — see the file's rejected-alternative
 * note below.
 *
 * WHY NOT `JSON.stringify(a) === JSON.stringify(b)` (mirroring
 * `fingerprint.ts`'s `canonicalize`): that approach silently treats
 * `undefined`, functions, and `NaN`/`Infinity` inconsistently (dropped
 * inside objects, `null` inside arrays, or thrown on `BigInt`) — exactly
 * the ambiguity this file exists to avoid, and it would require sorting
 * object keys again (a second, independent implementation of
 * `canonicalize` in a file that has no reason to duplicate it). A direct
 * recursive walk makes every one of those cases an explicit, intentional
 * branch instead of an implicit consequence of a stringifier.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  // Both must be non-null objects to recurse further; anything else that
  // reached here (primitives that differ, `null` vs a non-`null`, a
  // function, etc.) is already known unequal by `Object.is` above.
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    return false;
  }

  const aIsArray = Array.isArray(a);
  const bIsArray = Array.isArray(b);
  if (aIsArray !== bIsArray) return false; // an array is never equal to a plain object, same keys or not.

  if (aIsArray && bIsArray) {
    if (a.length !== b.length) return false;
    return a.every((entry, index) => deepEqual(entry, b[index]));
  }

  // Plain-object case. Deliberately does NOT reject a `Date`/`Map`/class
  // instance the way `isPlainData` does — this function's job is "are
  // these two values equal," not "is this value plain data," and a
  // malformed `Delta.before` that slipped past `isPlainData` upstream (a
  // gap `world.ts` already documents as known and unclosed) should still
  // compare as equal to an identical malformed value rather than this
  // function throwing on it. `Object.keys` only enumerates a class
  // instance's own enumerable properties, which is a degraded but safe
  // comparison for that case, not a crash.
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(aRecord[key], bRecord[key]),
  );
}
