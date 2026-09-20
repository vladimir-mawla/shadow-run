import type { AssumptionKind, Delta, ProjectedEffect } from "../contracts/index.js";

/**
 * Runtime structural validation of whatever value an adapter's `project()`
 * actually returned, BEFORE `simulate()` treats it as a trustworthy
 * `ProjectedEffect`. This is the direct answer to the build brief's own
 * question: "what happens when an adapter ... returns a malformed
 * `ProjectedEffect`?" — see `.genesis/decisions/0002-simulate.md` for the
 * full argument for why this file exists at all rather than trusting
 * TypeScript's compile-time shape.
 *
 * WHY A RUNTIME CHECK, WHEN `SimulationAdapter.project`'S RETURN TYPE IS
 * ALREADY `ProjectedEffect`: TypeScript's type system is a compile-time
 * discipline on code THIS REPOSITORY controls; it says nothing about a
 * value that arrives at runtime having been produced by a `project()`
 * implementation this milestone did not write and cannot fully see ahead
 * of time (a future domain adapter, M6's job; a test's deliberately-bad
 * fixture, `consistency.test.ts`; a value smuggled past the type checker
 * with `as ProjectedEffect`, the exact same class of gap `world.ts`'s
 * `isPlainData` exists to close for `World.data`, one layer over). A
 * `simulate()` that skipped this and trusted the declared return type
 * would be "a simulator that trusts its adapter" — precisely the
 * "story generator" failure mode the build brief names by name.
 *
 * WHAT IS AND ISN'T CHECKED HERE, STATED PLAINLY: this file checks SHAPE
 * (right fields, right primitive types, `assumptions`/`producedBy`/`kind`
 * drawn from their closed vocabularies) — it does NOT check whether the
 * `deltas` are actually consistent with the `World` they were computed
 * against, or whether `resultingFingerprint` is the honest hash of
 * applying them. That is `consistency.ts`'s job, deliberately kept
 * separate: a value can be well-SHAPED and still be a LIE about what it
 * predicts, and conflating "is this the right shape" with "is this true"
 * into one function would make it harder to name, in a failure report,
 * which of the two problems actually occurred.
 */

/** One structural problem found in a value that was supposed to be a `ProjectedEffect`. Free text is fine here — this describes why THIS ENGINE rejected a malformed value, not a claim a projection makes about the world; see `result.ts`'s header for why that distinction matters and does not reopen the "no free text" discipline `ProjectedEffect.assumptions` itself is held to. */
export type EffectShapeProblem = string;

const VALID_ASSUMPTION_KINDS: ReadonlySet<AssumptionKind> = new Set([
  "no-concurrent-writer",
  "world-version-unchanged",
  "clock-monotonic",
]);

const VALID_DELTA_KINDS: ReadonlySet<Delta["kind"]> = new Set(["set", "increment", "remove", "append"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates one `Delta`-shaped value found inside `deltas[index]`,
 * appending every problem found (there can be more than one per entry —
 * e.g. a bad `path` AND a bad `kind` on the same object) to `problems`
 * rather than stopping at the first, so a single malformed effect reports
 * everything wrong with it in one pass, not one problem per fix-and-rerun
 * cycle.
 */
function validateDeltaShape(value: unknown, index: number, problems: EffectShapeProblem[]): void {
  if (!isRecord(value)) {
    problems.push(`deltas[${index}] is not an object`);
    return;
  }
  if (typeof value["path"] !== "string" || value["path"].length === 0) {
    problems.push(`deltas[${index}].path must be a non-empty string`);
  }
  if (typeof value["kind"] !== "string" || !VALID_DELTA_KINDS.has(value["kind"] as Delta["kind"])) {
    problems.push(`deltas[${index}].kind must be one of "set" | "increment" | "remove" | "append", got ${JSON.stringify(value["kind"])}`);
  }
  // `before`/`after` are `unknown` by design (delta.ts) — nothing to validate about their shape beyond "the key exists," which `in` (not a presence-of-undefined check) verifies honestly even when the real value is `undefined`.
  if (!("before" in value)) problems.push(`deltas[${index}] is missing "before"`);
  if (!("after" in value)) problems.push(`deltas[${index}] is missing "after"`);
}

/**
 * The one entry point: validates `candidate` (whatever an adapter actually
 * returned, typed `unknown` here on purpose — see file header) against
 * `ProjectedEffect`'s full shape. Returns every problem found, or an empty
 * array if `candidate` is well-formed — never throws, so `simulate.ts` can
 * treat "malformed" as an ordinary, named `SimulationResult` failure
 * rather than a second, differently-shaped exception path to catch.
 */
export function validateEffectShape(candidate: unknown): readonly EffectShapeProblem[] {
  const problems: EffectShapeProblem[] = [];

  if (!isRecord(candidate)) {
    return ["projected effect is not an object"];
  }

  if (!Array.isArray(candidate["deltas"])) {
    problems.push('"deltas" must be an array');
  } else {
    candidate["deltas"].forEach((entry, index) => validateDeltaShape(entry, index, problems));
  }

  if (typeof candidate["resultingFingerprint"] !== "string" || candidate["resultingFingerprint"].length === 0) {
    problems.push('"resultingFingerprint" must be a non-empty string');
  }

  if (!Array.isArray(candidate["assumptions"])) {
    problems.push('"assumptions" must be an array');
  } else {
    candidate["assumptions"].forEach((entry, index) => {
      if (typeof entry !== "string" || !VALID_ASSUMPTION_KINDS.has(entry as AssumptionKind)) {
        problems.push(`assumptions[${index}] is not a member of the closed AssumptionKind enum, got ${JSON.stringify(entry)}`);
      }
    });
  }

  if (candidate["producedBy"] !== "shadow-execution") {
    problems.push(`"producedBy" must be exactly "shadow-execution", got ${JSON.stringify(candidate["producedBy"])}`);
  }

  return problems;
}

/** Narrows `candidate` to `ProjectedEffect` given an empty `problems` array from `validateEffectShape` — a small, honest cast boundary (this file already checked every field by hand; TypeScript has no way to know that) used exactly once, in `simulate.ts`, right after the check that makes it safe. */
export function asProjectedEffect(candidate: unknown): ProjectedEffect {
  return candidate as ProjectedEffect;
}
