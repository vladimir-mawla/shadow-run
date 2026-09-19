import type { Json } from "./world.js";

/**
 * `computeFingerprint` is the ONE hash function every `World` in this
 * codebase is stamped with, and the one every reconciliation and rollback
 * comparison calls to check hash equality — never a bespoke per-call-site
 * hash. Two requirements drove the design:
 *
 *   1. DETERMINISTIC KEY ORDER. `JSON.stringify({a:1,b:2})` and
 *      `JSON.stringify({b:2,a:1})` already happen to agree in V8 today
 *      (insertion order for string keys), but relying on that is relying on
 *      an implementation detail, not a spec guarantee, and this project's
 *      whole falsifiability story rests on "the same logical state hashes
 *      the same way, always." `canonicalize` below sorts every object's
 *      keys recursively before stringifying, so two `Json` values that are
 *      structurally equal but were *constructed* with keys in a different
 *      order (a real risk once M6 domains build `World.data` from their own
 *      record shapes) still fingerprint identically.
 *   2. NO NATIVE-BINDING DEPENDENCY. `node:crypto` would give a "real"
 *      cryptographic hash for free, but decision-engine's own ADR/comment
 *      history (this project's infrastructure sibling) already surfaces
 *      that pulling in extra native surface here is a needless risk for a
 *      hash that is never a security boundary — this is a change-detector,
 *      not a signature. FNV-1a is a small, dependency-free, well-known
 *      non-cryptographic hash that runs identically in Node and a browser,
 *      which matters if a later milestone (mirroring decision-engine's M8)
 *      ever runs simulate/reconcile client-side.
 *
 * REJECTED: hashing `World` as a whole (id/domain/version/at/data together).
 * `fingerprint` must depend on `data` ALONE — two `World`s with the same
 * data but different `version`/`at` (e.g. a fresh snapshot taken a second
 * later, nothing having changed) must fingerprint identically, because
 * `fingerprint` is what reconciliation and rollback compare for "did the
 * data actually change," not "was this snapshot taken at the same instant."
 */

function canonicalize(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sortedKeys = Object.keys(value).sort();
  const result: Record<string, Json> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalize((value as Record<string, Json>)[key] as Json);
  }
  return result;
}

/** FNV-1a, 32-bit, rendered as 8 lowercase hex digits. Not cryptographic — a change detector, not a signature (see file header). */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // Multiply by the FNV prime (16777619) using shifts/adds to stay in
    // 32-bit integer arithmetic without needing BigInt.
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The one fingerprint function every `World` in this codebase is stamped with. Pure: same `data`, same fingerprint, always — see file header. */
export function computeFingerprint(data: Json): string {
  return fnv1a(JSON.stringify(canonicalize(data)));
}
