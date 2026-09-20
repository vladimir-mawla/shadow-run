import type { Delta } from "../contracts/delta.js";
import { makeWorld, type Json, type World } from "../contracts/index.js";
import { deepEqual, getAtPath, setAtPath } from "./path.js";

/**
 * Thrown by `applyDeltas` the moment ANY step cannot be applied honestly —
 * see this file's header for why "cannot be applied" is deliberately
 * distinct from "cannot be inverted" (`invert-delta.ts` is total;
 * application is where a real mismatch surfaces). Named, not a bare
 * `Error`, specifically so a caller (`run-rollback.ts`, or a future M6
 * domain) can distinguish "this exact kind of failure" from any other
 * exception without string-matching a message — the same discipline
 * `NonPlainDataError` (`lib/contracts/world.ts`) already established for
 * this codebase.
 *
 * Carries the 0-based index of the step that failed and the exact `Delta`
 * involved, plus what was actually found at `delta.path` versus what the
 * step required — enough for a caller to print "step 2 of 4 expected
 * stock.reserved to be 42, found 45" rather than a bare "rollback failed."
 */
export class RollbackStepFailedError extends Error {
  constructor(
    readonly stepIndex: number,
    readonly delta: Delta,
    readonly foundAtPath: unknown,
  ) {
    super(
      `applyDeltas: step ${stepIndex} (path "${delta.path}", kind "${delta.kind}") expected the current ` +
        `value to equal its recorded "before" (${JSON.stringify(delta.before)}), but found ` +
        `${JSON.stringify(foundAtPath)}. Refusing to apply this or any later step — see apply-deltas.ts's ` +
        `header for why a partially-applied rollback is never returned.`,
    );
    this.name = "RollbackStepFailedError";
  }
}

/**
 * `applyDeltas` — the ONE generic interpreter that ever mutates a `World`,
 * forward OR in reverse (plan §A.4). This is deliberately the same
 * function for both directions: given a `deltas` array, it has no idea
 * (and does not need to know) whether it is replaying a domain's real
 * forward execution or running a `Rollback.runnable`'s inverted `steps` —
 * both are just "a list of `Delta`s to verify-then-apply, in the order
 * given." Which direction a caller is doing is entirely a fact about
 * WHAT ARRAY IT PASSES IN (see `run-rollback.ts` for how a rollback's
 * `steps` are constructed so that passing them here undoes the original
 * action, in the correct order — this file does not reverse anything
 * itself).
 *
 * PER-STEP RULE, THE SAME FOR ALL FOUR `Delta.kind` VALUES (see
 * `path.ts`'s header for why): read the current value at `delta.path`;
 * if it does not `deepEqual` the step's recorded `before`, THROW
 * (`RollbackStepFailedError`) rather than proceed. Otherwise write
 * `delta.after` at that path and move to the next step. `kind` is never
 * inspected here — it exists for `invertDelta` and for M4's reconciler,
 * not for this interpreter.
 *
 * ATOMICITY — THE SINGLE MOST IMPORTANT GUARANTEE IN THIS FILE, BECAUSE OF
 * THE FAILURE MODE THIS MILESTONE'S OWN BRIEF NAMES AS THE MOST DANGEROUS
 * STATE IN THE PROJECT: "`applyDeltas` throws partway through a `steps`
 * list; the world is then half-restored." This function structurally
 * cannot return a half-restored `World`:
 *
 *   - It NEVER mutates `world` or `world.data` (both are already
 *     `Object.freeze`-deep-frozen by `makeWorld`/`deepFreezeClone`,
 *     `lib/contracts/world.ts` — a mutation attempt on them would throw
 *     anyway, but this function does not even try). It builds its own
 *     private `structuredClone` of `world.data` and mutates ONLY that
 *     scratch copy, step by step, via `setAtPath`.
 *   - If ANY step's verification fails (or `structuredClone` itself
 *     rejects the data, which should be unreachable for a `World` built
 *     through `makeWorld` but is not assumed away here), this function
 *     THROWS IMMEDIATELY and returns nothing. The scratch copy — however
 *     far it got — is discarded with it; there is no code path that hands
 *     a caller a `World` reflecting SOME but not all of `deltas`.
 *   - Only after every step succeeds does this function hand the finished
 *     scratch copy to `makeWorld` (`lib/contracts/world.ts`) — reused
 *     rather than reimplemented, matching ADR 0001's forward note that a
 *     second, independent deep-freeze/validate walk is likely to get the
 *     DAG-safety and freeze-after-validation ordering wrong the first
 *     time. This buys three things for free: `assertPlainData` re-checks
 *     the rebuilt tree is still plain data (defense in depth against a
 *     `Delta.after` that smuggled in something non-plain), the result is
 *     deep-frozen exactly like every other `World` in this codebase, and
 *     `fingerprint` is computed by the one canonical
 *     `computeFingerprint` — never a bespoke hash here. There is exactly
 *     one `return` statement in this function, and it is unreachable
 *     unless the entire loop above completed.
 *
 * `id`/`domain`/`version`/`at` ARE CARRIED OVER FROM THE INPUT `world`
 * UNCHANGED — deliberately, and only correct for the direction this
 * milestone actually needs. A rollback conceptually returns to "the same
 * resource, restored," so keeping its identity and version number as-is
 * is the honest description of what happened; only `data` (and therefore
 * `fingerprint`) changes. This function does NOT decide what a FORWARD
 * application (a domain's real `applyReal()`, M6, advancing state to a
 * genuinely new version) should do with `version`/`at` — that is a
 * question for whichever milestone owns forward execution, out of scope
 * here, and this interpreter is deliberately silent about it rather than
 * guessing.
 *
 * A caller that wants "did this fail, and if so why, without losing the
 * original `World`" gets that for free from ordinary `try`/`catch`: this
 * function's own input `world` argument is never touched, so it is still
 * valid, still fingerprint-intact, in the `catch` block. See
 * `run-rollback.ts` for how the higher-level rollback-running API turns a
 * thrown `RollbackStepFailedError` into an explicit, typed `"failed"`
 * outcome rather than ever letting a half-applied result look like
 * success — see `__tests__/apply-deltas.test.ts` for the direct proof
 * (a deliberately-failing step 2 of 3, asserting the original `world`
 * argument is provably unchanged afterward).
 */
export function applyDeltas<TState extends Json>(
  world: World<TState>,
  deltas: ReadonlyArray<Delta>,
): World<TState> {
  const working = structuredClone(world.data) as Record<string, unknown>;

  for (let i = 0; i < deltas.length; i++) {
    const delta = deltas[i] as Delta;
    const current = getAtPath(working, delta.path);
    if (!deepEqual(current, delta.before)) {
      throw new RollbackStepFailedError(i, delta, current);
    }
    setAtPath(working, delta.path, delta.after);
  }

  return makeWorld<TState>({
    id: world.id,
    domain: world.domain,
    version: world.version,
    at: world.at,
    data: working as TState,
  });
}

/**
 * A non-throwing wrapper around `applyDeltas`, named so a caller has an
 * explicit, self-documenting way to ASK "would this succeed?" without
 * reading a `try`/`catch` around the real call as an implicit query.
 *
 * ADDED FOR THE CONCURRENT-WRITER CASE `.genesis/decisions/0004-
 * rollback.md` works through in detail: once rollback restores to "the
 * state immediately before THIS action's own write" (chosen there) rather
 * than "the simulation snapshot," a `steps` list built from THIS action's
 * own deltas can fail for a NEW reason that a pristine-snapshot rollback
 * never could — a concurrent actor touched the SAME `path` this rollback
 * needs, so the current real value no longer matches what this rollback's
 * `before` expects. That is not this milestone's bug to paper over; it is
 * the fail-closed signal ADR 0004 chose deliberately (refuse to overwrite
 * a path a concurrent actor has since touched, rather than clobber it).
 *
 * THIS FUNCTION IS NOT A SEPARATE SAFETY MECHANISM — `applyDeltas` already
 * never mutates the real `world` argument and never returns a partial
 * result on any failure (see this file's ATOMICITY section above), so
 * calling `applyDeltas` "for real" already carries zero risk of touching
 * real state on failure. What this function adds is purely VOCABULARY: a
 * caller who wants to know "should I even attempt this" — e.g. to decide
 * whether to escalate to a human instead of running a rollback that is
 * certain to fail — gets a `{ ok: false, ... }` value to branch on instead
 * of writing its own `try`/`catch`, and neither path is "more pre-flight"
 * than the other in terms of safety: both discover the problem before any
 * real `World` is ever touched.
 */
export function wouldApplyCleanly<TState extends Json>(
  world: World<TState>,
  deltas: ReadonlyArray<Delta>,
): { readonly ok: true } | { readonly ok: false; readonly stepIndex: number; readonly delta: Delta; readonly foundAtPath: unknown } {
  try {
    applyDeltas(world, deltas);
    return { ok: true };
  } catch (error) {
    if (error instanceof RollbackStepFailedError) {
      return { ok: false, stepIndex: error.stepIndex, delta: error.delta, foundAtPath: error.foundAtPath };
    }
    throw error;
  }
}
