export { type World, type Json, isPlainData, assertPlainData, NonPlainDataError } from "./world.js";
export { computeFingerprint } from "./fingerprint.js";
export type { Delta } from "./delta.js";
export { type ProjectedEffect, type AssumptionKind } from "./projected-effect.js";
export { type Reconciliation, assertNeverReconciliation } from "./reconciliation.js";
export { type Rollback } from "./rollback.js";
export { type SimulatorTrust } from "./simulator-trust.js";
