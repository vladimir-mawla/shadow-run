/**
 * `World<TState>` — a typed, addressable, versioned, hashed snapshot of
 * exactly the state slice an action touches. Everything downstream (a
 * simulated projection, a real execution, a reconciliation, a rollback)
 * reads and writes `World` values, never some other ambient notion of
 * "the database" — this is deliberately the *only* shape state comes in.
 *
 * WHY `data` MUST BE PLAIN, SERIALIZABLE DATA — NO FUNCTIONS, EVER.
 *
 * This is the single most load-bearing constraint in this file, and it is
 * enforced two ways at once, because TypeScript's structural type system
 * cannot fully close this gap on its own:
 *
 *   1. Type-level: `TState` is constrained to `Json` (defined below), a
 *      recursive union that admits primitives, plain objects, and arrays —
 *      and nothing else. A `TState` inferred from an object literal with a
 *      method, a `Date`, a `Map`, or a closure fails to satisfy `Json` and
 *      the `World<TState>` construction site itself does not compile (see
 *      `__tests__/world.test.ts`'s `@ts-expect-error` proofs). This catches
 *      the honest mistake — nobody writing `world.data = { onCancel: () =>
 *      {} }` gets past `tsc`.
 *   2. Runtime: `isPlainData` (below) walks an actual value and rejects
 *      functions, symbols, and non-plain-object prototypes structurally,
 *      because TypeScript's structural typing cannot stop a deliberate
 *      cast (`x as Json`) any more than it can for a branded type — see
 *      decision-engine's own `__tests__/brand-casts.test.ts` for the exact
 *      precedent this project follows for that gap. `assertPlainData`
 *      calls this at every construction boundary this milestone controls
 *      (`makeWorld` below) so the guarantee holds for values built through
 *      the one blessed constructor, not merely for values a careful author
 *      happened to type correctly.
 *
 * WHY THIS MATTERS BEYOND "clean code": `World.data` is what gets hashed
 * (`fingerprint`), diffed (`Delta`), recorded into an audit-style trail,
 * and replayed by a verifier. A function embedded in `data` would silently
 * break every one of those: `JSON.stringify` drops it without warning,
 * `structuredClone` throws, and a "hash" computed over data containing a
 * function would depend on the function's *identity*, not its behavior —
 * making the same logical state hash differently across two runs. Keeping
 * `data` plain is what makes "the same input twice produces the same
 * fingerprint twice" possible to prove at all (see M3's purity criterion in
 * the plan).
 *
 * REJECTED ALTERNATIVE: constrain `TState` with `unknown` and rely on
 * `fingerprint`'s hash function to fail loudly if it ever meets a function.
 * That pushes the guarantee from "cannot construct a bad World" to "a bad
 * World is only caught the first time something hashes it" — a much later,
 * harder-to-localize failure, and one that a `World` never fed to a hasher
 * (e.g. one only ever read for display) would never trip at all. Failing
 * at construction is strictly earlier and strictly more honest about where
 * the guarantee actually lives.
 */

/** The closed set of shapes `World.data` may ever hold — plain, serializable, no functions, no exotic objects. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };

export interface World<TState extends Json> {
  /** Stable identity of the resource/aggregate this snapshot describes (e.g. "sku-42", "cal-event-9"). */
  readonly id: string;
  /** Which domain owns this resource — "inventory" | "calendar" | "notification" | ... (a plain string here; domains are M6's job, not M1's, so this is deliberately not a closed union yet). */
  readonly domain: string;
  /** Monotonic sequence for this id. Used to detect a stale read (someone else moved the world since this snapshot was taken) before a write is permitted. */
  readonly version: number;
  /** ISO-8601 instant this snapshot was captured. */
  readonly at: string;
  /** Domain-typed, plain-data state. See the file header for why this can never contain a function. */
  readonly data: TState;
  /** Pure hash of `data` — the value exact-equality checks compare (e.g. "did rollback actually restore the pre-action World"). Computed the same mechanical way everywhere; never asserted by a caller. */
  readonly fingerprint: string;
}

/**
 * Runtime companion to the `Json` type constraint — see the file header's
 * "two ways at once" reasoning. Walks a value depth-first and returns
 * `false` the moment it finds anything that is not a plain primitive,
 * plain array, or plain object: a function, a symbol-keyed property, a
 * `Date`/`Map`/`Set`/class instance (anything whose prototype is not
 * `Object.prototype` or `null`), or a circular reference (which
 * `JSON.stringify`-based hashing could not handle anyway and which this
 * project never needs — `World.data` describes a snapshot, not a live
 * object graph).
 *
 * Deliberately conservative rather than merely "not a function": a
 * `Map`/`Set`/`Date` would pass a naive "typeof !== 'function'" check and
 * still break `fingerprint`'s hash (see `fingerprint.ts`) the same way a
 * closure would — silently, and only when hashed, not when constructed.
 */
export function isPlainData(value: unknown, seen: ReadonlySet<unknown> = new Set()): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t === "function" || t === "symbol" || t === "undefined" || t === "bigint") return false;

  // t === "object" from here on.
  if (seen.has(value)) return false; // circular reference: not plain, structured-clone-hostile.
  const nextSeen = new Set(seen).add(value as object);

  if (Array.isArray(value)) {
    return value.every((entry) => isPlainData(entry, nextSeen));
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false; // rejects Date, Map, Set, class instances, etc.

  for (const key of Object.getOwnPropertySymbols(value)) {
    void key;
    return false; // symbol-keyed properties are not representable in Json.
  }
  return Object.values(value as Record<string, unknown>).every((entry) => isPlainData(entry, nextSeen));
}

/** Thrown by `assertPlainData` — named so a caller can distinguish "your data isn't plain" from any other error at a World construction boundary. */
export class NonPlainDataError extends Error {
  constructor(context: string) {
    super(`${context}: value is not plain, serializable data (found a function, symbol, or non-plain object).`);
    this.name = "NonPlainDataError";
  }
}

/** Throws `NonPlainDataError` if `value` is not plain data. The one runtime gate every blessed `World` constructor in this codebase must call — see the file header. */
export function assertPlainData(value: unknown, context: string): void {
  if (!isPlainData(value)) {
    throw new NonPlainDataError(context);
  }
}
