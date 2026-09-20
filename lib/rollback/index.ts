export { invertDelta } from "./invert-delta.js";
export { applyDeltas, wouldApplyCleanly, RollbackStepFailedError } from "./apply-deltas.js";
export {
  buildRollbackSteps,
  verifyStepsAreHonestInversion,
  runRollback,
  type RollbackOutcome,
} from "./run-rollback.js";
export { deepEqual, getAtPath, setAtPath } from "./path.js";
