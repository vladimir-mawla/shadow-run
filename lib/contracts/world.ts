import { computeFingerprint } from "./fingerprint.js";

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
 *      functions, symbols, non-plain-object prototypes, and accessor
 *      properties (a `get`/`set` pair) structurally. The gap this closes is
 *      WIDER than "a deliberate `x as Json` cast": TypeScript types an
 *      object-literal getter by its RETURN type, so `{ get x() { return
 *      1; } }` satisfies `Json` with NO cast anywhere —
 *      `const asJson: Json = { get x() { return 1; } }` compiles clean.
 *      `isPlainData` rejects any own accessor property, without ever
 *      invoking it, because nothing requires two reads of a getter to
 *      agree — a value whose reads are not stable breaks this file's
 *      "same input, same fingerprint, always" premise exactly as badly as
 *      a closure would, cast or no cast. The plain-cast case still mirrors
 *      decision-engine's own `__tests__/brand-casts.test.ts` precedent.
 *      `assertPlainData` calls this at every construction boundary this
 *      milestone controls (`makeWorld` below) so the guarantee holds for
 *      values built through the one blessed constructor, not merely for
 *      values a careful author happened to type correctly.
 *
 *      KNOWN, UNCLOSED GAP — stated plainly, not softened: a hostile
 *      `Proxy` defeats this walk entirely, and nothing in this milestone
 *      defends against it. Every fact `isPlainData` learns about a value —
 *      its own keys (`Object.getOwnPropertyNames`/`getOwnPropertySymbols`),
 *      its prototype (`Object.getPrototypeOf`), its property descriptors,
 *      its values (`Object.values`) — is answered by a trap
 *      (`ownKeys`/`getPrototypeOf`/`getOwnPropertyDescriptor`/`get`) that a
 *      `Proxy` fully controls. A `Proxy` can report "just one plain number
 *      key, ordinary `Object.prototype`, no accessors here" to every one of
 *      those calls while a function-valued or unstable property is really
 *      reachable on it by name. `isPlainData` has no way to distinguish
 *      that `Proxy` from an honest plain object, in Node or a browser,
 *      without a runtime-specific, easily-bypassed check (e.g. Node's
 *      `util.types.isProxy`, deliberately not used here — it doesn't exist
 *      in a browser, and a `Proxy` wrapping a `Proxy` defeats naive
 *      detection anyway). See `__tests__/world.test.ts`'s "KNOWN
 *      LIMITATION" test for a working demonstration of exactly this gap,
 *      not a fix for it.
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
 * True if `value` has any own accessor property — a `get` and/or `set`
 * — enumerable or not, on a plain object OR at an array index. Checked
 * via `Object.getOwnPropertyDescriptor`, which reads the descriptor
 * without ever invoking the accessor itself, so a stateful getter (like
 * the `n++`-on-every-read example this guards against — see
 * `__tests__/world.test.ts`) is never triggered as a side effect of this
 * check. See the file header's point 2 for why an accessor property is
 * rejected even though it is not a function: nothing requires two reads
 * of it to agree, which is exactly the property `isPlainData` exists to
 * guarantee.
 *
 * Does NOT and cannot detect a `Proxy` presenting a fabricated,
 * accessor-free view of itself — see the file header's "KNOWN, UNCLOSED
 * GAP" paragraph. This function is honest about plain objects and arrays
 * only.
 */
function hasOwnAccessorProperty(value: object): boolean {
  for (const key of Object.getOwnPropertyNames(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && (descriptor.get !== undefined || descriptor.set !== undefined)) return true;
  }
  return false;
}

/**
 * Runtime companion to the `Json` type constraint — see the file header's
 * "two ways at once" reasoning. Walks a value depth-first and returns
 * `false` the moment it finds anything that is not a plain primitive,
 * plain array, or plain object: a function, a symbol-keyed property, a
 * `Date`/`Map`/`Set`/class instance (anything whose prototype is not
 * `Object.prototype` or `null`), an accessor property (a getter and/or
 * setter — see `hasOwnAccessorProperty` above and the file header's point
 * 2: TypeScript types an object-literal getter by its return type, so
 * this needs no cast to defeat the type system), or a circular reference
 * (which `JSON.stringify`-based hashing could not handle anyway and which
 * this project never needs — `World.data` describes a snapshot, not a
 * live object graph).
 *
 * Deliberately conservative rather than merely "not a function": a
 * `Map`/`Set`/`Date` would pass a naive "typeof !== 'function'" check and
 * still break `fingerprint`'s hash (see `fingerprint.ts`) the same way a
 * closure would — silently, and only when hashed, not when constructed.
 *
 * NOT airtight — see the file header's "KNOWN, UNCLOSED GAP" paragraph. A
 * `Proxy` that fabricates its own `ownKeys`/`getOwnPropertyDescriptor`/
 * `getPrototypeOf` answers can hide a function-valued or accessor property
 * from every check this function makes. This function defends the honest
 * "someone built a plain object/array and it happens to contain a bad
 * value" case and the "someone cast around the type system" case; it does
 * not and cannot defend against a value engineered specifically to lie to
 * reflection APIs.
 */
export function isPlainData(value: unknown, seen: ReadonlySet<unknown> = new Set()): boolean {
  if (value === null) return true;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return true;
  if (t === "function" || t === "symbol" || t === "undefined" || t === "bigint") return false;

  // t === "object" from here on.
  if (seen.has(value)) return false; // circular reference: not plain, structured-clone-hostile.
  const nextSeen = new Set(seen).add(value as object);

  // Checked BEFORE any value is read off `value`, so a stateful getter is
  // never invoked as a side effect of walking past it.
  if (hasOwnAccessorProperty(value as object)) return false;

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

/**
 * Deep-clones `value`, freezing every object and array in the resulting
 * tree (`Object.freeze` is shallow — freezing only the root would leave
 * every nested object/array mutable). Reusable independent of `makeWorld`:
 * M3's `simulate()` boundary (plan §A.1) is documented to need the same
 * "deep-freeze the input so a mutation attempt throws rather than silently
 * succeeding" guarantee — see ADR 0001 for the note that M3 should call
 * this rather than write a second deep-freeze walk.
 *
 * CLONES rather than freezing `value` in place. This is a deliberate
 * choice, not an oversight: freezing the caller's own object would mean
 * `makeWorld({ ..., data: someObject })` silently makes `someObject`
 * permanently immutable everywhere else the caller holds a reference to
 * it — including the extremely common pattern this project's own domain
 * is built around, evolving one working object across a sequence of
 * snapshots (`const before = makeWorld({ ..., data: state }); state.qty--;
 * const after = makeWorld({ ..., data: state })`). Freezing in place would
 * make the second call's mutation throw before it ever happens. Cloning
 * costs one full traversal-and-copy of `data` per call and means
 * `world.data !== input.data` even though they are deep-equal at the
 * moment of construction — accepted as the right trade for keeping the
 * caller's own copy of their data usable after the call.
 *
 * DAG-safe, not just cycle-safe: `cache` maps an original reference to its
 * already-built replacement, so a value reachable from two different
 * paths in the same input (legal — `isPlainData` rejects true cycles, but
 * not a shared, acyclic reference) is cloned and frozen exactly once, and
 * both paths in the output point at the same frozen clone rather than two
 * independent copies. The cache is populated before recursing into a
 * value's own children specifically so a genuine cycle (one that somehow
 * reached this function despite `assertPlainData` already having rejected
 * it) would return the in-progress clone instead of recursing forever —
 * defense in depth, not the primary cycle guard.
 */
export function deepFreezeClone<T extends Json>(value: T, cache: Map<object, unknown> = new Map()): T {
  if (value === null || typeof value !== "object") return value; // primitives are already immutable.

  const cached = cache.get(value);
  if (cached !== undefined) return cached as T;

  if (Array.isArray(value)) {
    const clone: unknown[] = [];
    cache.set(value, clone);
    for (const entry of value) clone.push(deepFreezeClone(entry as Json, cache));
    return Object.freeze(clone) as T;
  }

  const clone: Record<string, unknown> = {};
  cache.set(value, clone);
  for (const [key, entry] of Object.entries(value)) {
    clone[key] = deepFreezeClone(entry as Json, cache);
  }
  return Object.freeze(clone) as T;
}

/**
 * The one blessed `World` constructor referenced throughout this file's
 * header and `assertPlainData`'s own doc comment. Three things make a
 * `World` built here strictly safer than a hand-assembled object literal
 * satisfying the `World<TState>` interface:
 *
 *   1. It calls `assertPlainData` on `data` before anything else, so the
 *      runtime gate the file header argues for is actually load-bearing
 *      for values built through this function, not merely exported and
 *      exercised only in `__tests__/`. Validation happens BEFORE cloning
 *      or freezing (point 3) — freezing something this function is about
 *      to reject would be pointless work at best.
 *   2. It computes `fingerprint` itself, via `computeFingerprint`
 *      (fingerprint.ts) — there is no `fingerprint` parameter to pass in
 *      the first place (see `__tests__/world.test.ts`'s
 *      `@ts-expect-error` proof). A caller supplying a stale or wrong
 *      fingerprint FOR THE INPUT is a defect class this constructor makes
 *      structurally impossible. That is a distinct guarantee from point 3
 *      below — having nowhere to smuggle in a bad fingerprint doesn't by
 *      itself stop the returned `data` from drifting out from under a
 *      correct one after construction; that's what point 3 closes.
 *   3. It deep-clones and deep-freezes `data` (`deepFreezeClone` above)
 *      before returning it, so the returned `World.data` is independent
 *      of whatever the caller keeps mutating and cannot itself be mutated
 *      afterward — a `World` is a snapshot, and a snapshot that changes
 *      under you is not one. This is a RUNTIME guarantee, distinct from
 *      `World.data`'s compile-time `readonly` (interface fields):
 *      `readonly` only stops `world.data = ...` from typechecking, and
 *      says nothing about `world.data.someNestedField = ...`, and nothing
 *      at all once a caller reaches for `as any`. `Object.freeze` is what
 *      actually makes a mutation attempt on the returned value throw (in
 *      this codebase's all-ESM, always-strict-mode files) instead of
 *      silently no-op-ing.
 *
 * A `World` value can still be assembled by hand outside this function —
 * TypeScript's structural typing cannot forbid that, the same gap the
 * file header describes for `data` itself, and a hand-built `World` gets
 * none of the three guarantees above. `__tests__/` builds `World` literals
 * directly on purpose, to exercise the type-level and runtime guards in
 * isolation; that is not a call site this function needs to replace.
 */
export function makeWorld<TState extends Json>(input: {
  readonly id: string;
  readonly domain: string;
  readonly version: number;
  readonly at: string;
  readonly data: TState;
}): World<TState> {
  assertPlainData(input.data, `makeWorld(id="${input.id}")`);
  const data = deepFreezeClone(input.data);
  return {
    id: input.id,
    domain: input.domain,
    version: input.version,
    at: input.at,
    data,
    fingerprint: computeFingerprint(data),
  };
}
