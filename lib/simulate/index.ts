/**
 * Public barrel for `lib/simulate/**` — mirrors `lib/contracts/index.ts`'s
 * own shape. Deliberately does NOT export two internal-only primitives,
 * for the same reason in both cases even though the shapes differ:
 *
 *   - `path.ts`'s `getAtPath`/`setAtPath`/`deleteAtPath`/
 *     `PathResolutionError` — an internal implementation detail of
 *     `consistency.ts`'s self-consistency check (see `path.ts`'s own
 *     header for why keeping them unexported matters for M5).
 *   - `effect-validation.ts`'s `asProjectedEffect` — a zero-validation
 *     type cast, NOT a check. It exists only to narrow a value
 *     `simulate.ts` has ALREADY validated (`validateEffectShape` returned
 *     zero problems) into `ProjectedEffect`, one line before use, in the
 *     one file that earns the right to call it that way. Exporting it
 *     from this barrel was a real defect, found and fixed after
 *     independent verification produced a working exploit: any external
 *     caller could import it, hand it complete garbage, and get back a
 *     value typed `ProjectedEffect` with zero of `simulate()`'s four
 *     gates having run —
 *     `{ ok: true, effect: asProjectedEffect({ deltas: "not even an
 *     array" }) }` compiled and ran clean before this fix, defeating the
 *     entire fail-closed design in `result.ts` from ONE IMPORT outside
 *     this module, without ever calling `simulate()` at all. The type-
 *     level narrowing `SimulationResult` itself performs is NOT the
 *     problem and is not touched here — a caller genuinely cannot
 *     destructure `.effect` off a narrowed `{ ok: false }` branch; the
 *     hole was this one unguarded escape hatch into the `ok: true`
 *     shape, reachable without going through `simulate()` at all. See
 *     `effect-validation.ts`'s own header for why this function still
 *     exists (just not exported) and stays that way.
 */
export type { Action } from "./action.js";
export type { SimulationAdapter } from "./adapter.js";
export { checkConsistency, type ConsistencyProblem, type ConsistencyResult } from "./consistency.js";
export { validateEffectShape, type EffectShapeProblem } from "./effect-validation.js";
export { assertNeverSimulationFailure, type SimulationFailure, type SimulationResult } from "./result.js";
export { simulate } from "./simulate.js";
