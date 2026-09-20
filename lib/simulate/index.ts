/**
 * Public barrel for `lib/simulate/**` — mirrors `lib/contracts/index.ts`'s
 * own shape. Deliberately does NOT export `path.ts`'s primitives
 * (`getAtPath`/`setAtPath`/`deleteAtPath`/`PathResolutionError`): those are
 * an internal implementation detail of `consistency.ts`'s self-consistency
 * check, not part of this milestone's public contract — see `path.ts`'s
 * own header for why keeping them unexported matters for M5.
 */
export type { Action } from "./action.js";
export type { SimulationAdapter } from "./adapter.js";
export { checkConsistency, type ConsistencyProblem, type ConsistencyResult } from "./consistency.js";
export { asProjectedEffect, validateEffectShape, type EffectShapeProblem } from "./effect-validation.js";
export { assertNeverSimulationFailure, type SimulationFailure, type SimulationResult } from "./result.js";
export { simulate } from "./simulate.js";
