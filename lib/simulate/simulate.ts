import { computeFingerprint, deepFreezeClone, type Json, type World } from "../contracts/index.js";
import type { Action } from "./action.js";
import type { SimulationAdapter } from "./adapter.js";
import { checkConsistency } from "./consistency.js";
import { asProjectedEffect, validateEffectShape } from "./effect-validation.js";
import type { SimulationResult } from "./result.js";

/**
 * `simulate(action, world, adapter)` — shadow execution (`sim-plan.md`
 * §A.1): run the same effect logic a real write would run, against a
 * CLONED `World`, so the mutation never escapes to the real world, and
 * return a typed `ProjectedEffect` — never committing, never a sentence.
 * See `.genesis/decisions/0002-simulate.md` for the full design record;
 * this header covers the two success criteria the build brief calls out
 * by name (purity, non-mutation) plus how the four checks below compose
 * into `SimulationResult`'s fail-closed shape (`result.ts`).
 *
 * THE FOUR GATES, IN ORDER — each one is a chance to fail closed rather
 * than hand back something unverified (see `result.ts` for why each
 * variant carries no usable effect alongside its failure):
 *
 *   1. `assertInputWorldIsSelfConsistent` — is the INPUT already lying
 *      about itself (`fingerprint` doesn't match `data`)? If so, nothing
 *      downstream can be trusted either, so this runs before the adapter
 *      is even called.
 *   2. Call `adapter.project(action, safeWorld)` inside try/catch — did
 *      the adapter throw?
 *   3. `validateEffectShape` — is the returned value even a well-shaped
 *      `ProjectedEffect`?
 *   4. `checkConsistency` — do the claimed `deltas` actually produce the
 *      claimed `resultingFingerprint`, starting from values that are
 *      actually there? (`consistency.ts` — the strongest of the four,
 *      and the direct answer to "you're just asking a model to guess.")
 *
 * NON-MUTATION (build brief success criterion (b)): `safeWorld.data` is
 * built by calling `deepFreezeClone` (`lib/contracts/world.ts`) on
 * `world.data` — REUSED, not reimplemented, per ADR 0001's own forward
 * note to this milestone ("M3 should import and call `deepFreezeClone`
 * from `lib/contracts` for that, not write a second deep-freeze walk").
 * It does NOT fit to freeze the caller's own `world` object in place
 * instead (the alternative that would make "the input World" and "what
 * the adapter sees" literally the same object): `deepFreezeClone` is
 * deliberately clone-then-freeze, never freeze-in-place (`world.ts`'s own
 * header explains why — freezing a caller's object out from under them
 * is not this layer's call to make either). That is exactly why this
 * function builds a SEPARATE `safeWorld` rather than assuming callers
 * always construct their `World` via `makeWorld` (which already returns
 * frozen `data`): an adapter must never be able to mutate real state
 * REGARDLESS of how the `World` it was handed came to exist, including a
 * hand-built `World` literal that skipped `makeWorld` entirely (exactly
 * what `__tests__/immutability.test.ts` exercises on purpose, the same
 * way `lib/contracts/__tests__/` builds `World` literals directly to test
 * guards in isolation rather than only ever going through the one
 * blessed constructor).
 *
 * PURITY (build brief success criterion (a)) — STATED HONESTLY, NOT
 * OVERCLAIMED, AND SCOPED TO THE EXACT SHAPE OF WHAT IS ACTUALLY CHECKED
 * (tightened after independent verification found the earlier wording
 * broader than what was proven): this function's OWN code introduces no
 * non-determinism — no `Date.now()`, no `Math.random()`, no reliance on
 * `Set`/`Map` iteration order to build output (`effect-validation.ts` and
 * `consistency.ts` both iterate the ADAPTER's own arrays in the order the
 * adapter gave them, never a `Set`/`Map` insertion-order artifact of this
 * engine's own construction), and given the SAME `action`/`world`/
 * `adapter`, this function's own control flow is deterministic. What this
 * CANNOT do is force `adapter.project` itself to be pure — nothing in a
 * function's TYPE SIGNATURE stops its BODY from calling `Date.now()` or
 * `Math.random()`, and no test can prove a universal negative over
 * arbitrary future domain code (the same limits `isPlainData`'s "known,
 * unclosed gap" paragraph states for a hostile `Proxy`, one layer over).
 *
 * THE PRECISE, NARROWER CLAIM, NAMED RATHER THAN LEFT ABSTRACT: what
 * `__tests__/purity.test.ts` proves is DETECTION of impurity that
 * MANIFESTS IN THE RETURNED `ProjectedEffect` BETWEEN TWO CALLS WITH
 * IDENTICAL INPUT — nothing broader than that. Three concrete gaps this
 * does NOT cover, confirmed by independent verification rather than
 * left as a vague disclaimer:
 *
 *   1. An adapter that calls `Date.now()`/`Math.random()` on EVERY
 *      invocation but never lets the result reach the returned `deltas`/
 *      `resultingFingerprint` (e.g. it reads the clock only to log,
 *      or to pick an internal code path that happens to produce the
 *      same output either way) passes this check unconditionally — the
 *      side effect is real, but invisible to a check that only ever
 *      compares OUTPUTS.
 *   2. An adapter impure only from its Nth call onward (an internal
 *      counter, a cache that fills after a few calls) reads as pure
 *      under a test that only calls it two or three times — impurity
 *      that needs more repetitions than the shipped tests happen to run
 *      is invisible to them by construction, not by any special defense
 *      this engine has against it.
 *   3. An adapter impure only for a specific input this milestone's
 *      tests never happened to exercise reads as pure for every input
 *      they DID exercise — this is the same "no test can prove a
 *      universal negative" limit stated above, made concrete rather than
 *      left as an abstract caveat.
 *
 * `__tests__/purity.test.ts` proves the positive case (a real
 * deterministic adapter run three times deep-equals itself, with THIS
 * function contributing zero non-determinism of its own) and
 * demonstrates the DETECTABLE half of the gap with a deliberately-impure
 * adapter (one that calls `Math.random()` and lets it flow into the
 * returned effect) whose two `simulate()` calls do NOT deep-equal each
 * other — proof that this engine neither adds nor hides THAT SHAPE of
 * impurity, never a claim that impurity in general is caught.
 *
 * WHY `action` IS ALSO DEEP-FROZEN before being handed to the adapter:
 * the exact same reasoning as `world.data` — `action.params` is `Json`
 * (action.ts), and an adapter that could mutate its own input parameters
 * in place would be exactly as unsafe as one that could mutate `World`,
 * just one call argument over. Cheap to close given `deepFreezeClone`
 * already exists and is already imported for `world.data`.
 */

/** Thin, named wrapper so `assertInputWorldIsSelfConsistent`'s failure has a distinguishable type to catch — never thrown across this module's own public boundary (see `simulate`'s try/catch around it, which turns this into the `invalid-world` `SimulationResult` failure). */
class InvalidWorldError extends Error {
  constructor(
    public readonly declaredFingerprint: string,
    public readonly actualFingerprint: string,
  ) {
    super(`World.fingerprint ("${declaredFingerprint}") does not match computeFingerprint(World.data) ("${actualFingerprint}")`);
    this.name = "InvalidWorldError";
  }
}

/** Gate 1 — see file header. Runs BEFORE the adapter is ever called: a `World` that already contradicts itself makes every later check meaningless (garbage in, garbage out, except this engine refuses the "in" rather than silently producing a "garbage out"). */
function assertInputWorldIsSelfConsistent(data: Json, declaredFingerprint: string): void {
  const actualFingerprint = computeFingerprint(data);
  if (actualFingerprint !== declaredFingerprint) {
    throw new InvalidWorldError(declaredFingerprint, actualFingerprint);
  }
}

export function simulate<TState extends Json>(
  action: Action,
  world: World<TState>,
  adapter: SimulationAdapter<TState>,
): SimulationResult {
  try {
    assertInputWorldIsSelfConsistent(world.data, world.fingerprint);
  } catch (error) {
    if (error instanceof InvalidWorldError) {
      return { ok: false, failure: { kind: "invalid-world", declaredFingerprint: error.declaredFingerprint, actualFingerprint: error.actualFingerprint } };
    }
    throw error; // not this gate's failure mode — a real bug, not a named one; let it surface loudly rather than mislabeling it.
  }

  // Gate 2 setup: neither the World the adapter sees nor the Action it
  // reads are the caller's own live objects — see file header's "does
  // not fit to freeze in place" paragraph for why this is a fresh clone,
  // not the input frozen where it stands.
  const safeWorld: World<TState> = { ...world, data: deepFreezeClone(world.data) };
  const safeAction: Action = { ...action, params: deepFreezeClone(action.params) };

  let rawEffect: unknown;
  try {
    rawEffect = adapter.project(safeAction, safeWorld);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return { ok: false, failure: { kind: "adapter-threw", error: message } };
  }

  // Gate 3.
  const shapeProblems = validateEffectShape(rawEffect);
  if (shapeProblems.length > 0) {
    return { ok: false, failure: { kind: "malformed-effect", problems: shapeProblems } };
  }
  const effect = asProjectedEffect(rawEffect);

  // Gate 4 — the strongest check; see consistency.ts's own header.
  const consistency = checkConsistency(safeWorld.data, effect);
  if (!consistency.ok) {
    return { ok: false, failure: { kind: "inconsistent-effect", problems: consistency.problems } };
  }

  return { ok: true, effect };
}
