import { deepEqual } from "../lib/reconcile/deep-equal";

/**
 * THE ONE CHECK `RestorationVerdict.tsx`'s PRIMARY BADGE IS ALLOWED TO READ
 * (m8-demo-design.md §2). Deliberately takes no fingerprint anywhere in its
 * signature — a badge built from this function structurally cannot fall
 * back to hash equality, because hash equality was never given to it.
 *
 * WHY NOT THE FINGERPRINT: `computeFingerprint` (lib/contracts/fingerprint.ts)
 * is a 32-bit FNV-1a — a change detector, not a signature, by its own
 * header's own words — and this project's own inventory field has a real,
 * verified collision: `computeFingerprint({ reserved: 412789 })` and
 * `computeFingerprint({ reserved: 649192 })` both hash to `2ba95242` (see
 * this file's own test, which re-runs the shipped `computeFingerprint`
 * rather than trusting the quoted digits). Two states that are NOT equal
 * can share one fingerprint; a restoration claim built on fingerprint
 * equality alone could be confidently wrong. Structural deep-equality
 * cannot produce that false positive for these two objects — see the test.
 *
 * `deepEqual` (lib/reconcile/deep-equal.ts) is the same structural-equality
 * primitive `reconcile()` itself uses to compare a `Delta.before`/`.after`
 * pair, reused here rather than re-implemented, so "restored" means
 * exactly what this codebase already means by "the same data," everywhere
 * else it asks that question.
 */
export function isFullyRestored(restoredData: unknown, preActionData: unknown): boolean {
  return deepEqual(restoredData, preActionData);
}
