import { simulate } from "../lib/simulate/index.js";
import { reconcile } from "../lib/reconcile/index.js";
import { applyDeltas, deepEqual, runRollback, verifyStepsAreHonestInversion } from "../lib/rollback/index.js";
import type { Delta, Reconciliation, Rollback } from "../lib/contracts/index.js";
import { ALL_CASES, netDeltas } from "../domains/index.js";
import type { DomainCase } from "../domains/types.js";

/**
 * `npm run demo:domains` — M6's own demo command (`.genesis/PLAN.md`),
 * running every case in `domains/**` through the REAL, frozen engine
 * (`simulate()`, `reconcile()`, `runRollback()`) and printing, per case,
 * the projected delta, the observed delta, the `Reconciliation` status,
 * and the `Rollback` outcome — never a narrated or hand-typed answer.
 * This script contains no reconciliation or trust-gate logic of its own
 * beyond ONE explicit, named, per-case policy choice (`rollbackPolicy` —
 * `domains/types.ts`): whether a proposed `Rollback.runnable` actually
 * gets executed. `.genesis/PLAN.md`'s own M6 summary places exactly that
 * decision here, in "the M6 wiring script," not inside a domain.
 *
 * Exits non-zero if any case's real outcome disagrees with its own
 * declared expectation, or if the full run does not hit all three
 * `Reconciliation` statuses and both `Rollback` kinds at least once
 * (M6's success criteria, `.genesis/PLAN.md`) — a demo that narrates
 * coverage it did not actually observe is worse than one that admits it
 * fell short.
 */

const DIVIDER = "─".repeat(78);

function fmt(value: unknown): string {
  return JSON.stringify(value);
}

/**
 * ADR 0003's own forward note to M6/M8, honored here: `Reconciliation
 * .drifted.actual` MAY be synthesized (the "vanished prediction" case)
 * rather than genuinely observed, and is structurally indistinguishable
 * from a real one. `actual.before === actual.after` detects "no net
 * change at this path" — NOT synthesis, a materially different claim
 * (a genuinely observed no-op delta would trip the identical check). This
 * function is named for exactly what it proves, per that note's own
 * instruction not to describe it as detecting provenance, and it is used
 * only to choose honest presentation text, never to assert anything about
 * how the value was produced.
 */
function describeActual(actual: Delta): string {
  if (deepEqual(actual.before, actual.after)) {
    return `no change was observed at "${actual.path}" (before/after identical at this path — this reports ` +
      `"no net change," not "nothing happened here": see ADR 0003's forward note on why this can never be ` +
      `distinguished from a synthesized no-op entry from this value alone)`;
  }
  return `observed: ${fmt(actual.before)} -> ${fmt(actual.after)}`;
}

function printReconciliation(reconciliation: Reconciliation): void {
  switch (reconciliation.status) {
    case "confirmed":
      console.log(`    reconciliation: confirmed  (${reconciliation.matched.length} delta(s) matched)`);
      return;
    case "drifted":
      console.log(`    reconciliation: DRIFTED at "${reconciliation.expected.path}"`);
      console.log(`      predicted: ${fmt(reconciliation.expected.before)} -> ${fmt(reconciliation.expected.after)}`);
      console.log(`      ${describeActual(reconciliation.actual)}`);
      return;
    case "unprojected":
      console.log(`    reconciliation: UNPROJECTED at "${reconciliation.actual.path}"`);
      console.log(`      ${describeActual(reconciliation.actual)}  (project() never predicted this path at all)`);
      return;
  }
}

function printRollbackProposal(rollback: Rollback): void {
  if (rollback.kind === "unavailable") {
    console.log(`    rollback: UNAVAILABLE — ${rollback.reason}`);
    console.log(`      blastRadius: ${rollback.blastRadius.map((d) => d.path).join(", ")}`);
    return;
  }
  console.log(`    rollback: runnable, ${rollback.steps.length} step(s):`);
  for (const step of rollback.steps) {
    console.log(`      ${step.kind.padEnd(9)} ${step.path}: ${fmt(step.before)} -> ${fmt(step.after)}`);
  }
}

/** Runs one `DomainCase` through the real pipeline and returns whether it matched every expectation it declared. */
function runCase(testCase: DomainCase): boolean {
  console.log(`  [${testCase.id}] ${testCase.title}`);
  console.log(`    ${testCase.narrative}`);

  const simResult = simulate(testCase.action, testCase.initialWorld, { project: testCase.adapter.project });
  if (!simResult.ok) {
    // None of this milestone's own cases are constructed to hit a
    // SimulationFailure — a real domain adapter that trips one of
    // simulate()'s four fail-closed gates is a bug in this case's own
    // setup, not a demo outcome to narrate past.
    console.log(`    SIMULATE FAILED: ${JSON.stringify(simResult.failure)}`);
    console.log("");
    return false;
  }
  const projected = simResult.effect;
  // `simResult.effect.deltas` is the RAW pipeline `project()` returned —
  // exactly what `simulate()`'s own internal `checkConsistency` already
  // validated it against. `netDeltas` collapses it to at most one entry
  // per `path` ONLY here, for reconciliation and for display — never
  // fed back into `simulate()` or `applyDeltas` — see
  // `domains/shared/net.ts`'s header for why this is the one and only
  // place netting happens.
  const projectedForReconciliation = netDeltas(projected.deltas);
  console.log(`    projected (against the world as simulate() saw it):`);
  for (const delta of projectedForReconciliation) {
    console.log(`      ${delta.kind.padEnd(9)} ${delta.path}: ${fmt(delta.before)} -> ${fmt(delta.after)}`);
  }

  // The REAL, injected TOCTOU race (inventory INV-2 only): a second real
  // writer's write, landing between simulate() and this action's own
  // applyReal() — see domains/types.ts's header on why this is kept
  // structurally distinct from injectUnrelatedConcurrentDelta below.
  const worldBeforeThisWrite = testCase.injectConcurrentWrite
    ? testCase.injectConcurrentWrite(testCase.initialWorld)
    : testCase.initialWorld;

  const { world: worldAfterOwnWrite, observedDeltas } = testCase.adapter.applyReal(testCase.action, worldBeforeThisWrite);

  // The REAL, injected UNRELATED concurrent write (inventory INV-3 only):
  // a genuinely different action type, on a path this domain's project()
  // never claims — applied for real via the same engine-owned applyDeltas
  // interpreter every rollback in this codebase also uses, so this
  // "different writer's real write" is exactly as real as this action's
  // own.
  let worldAfterEverything = worldAfterOwnWrite;
  let observedForReconciliation: ReadonlyArray<Delta> = netDeltas(observedDeltas);
  if (testCase.injectUnrelatedConcurrentDelta) {
    worldAfterEverything = applyDeltas(worldAfterOwnWrite, [testCase.injectUnrelatedConcurrentDelta]);
    observedForReconciliation = [...netDeltas(observedDeltas), testCase.injectUnrelatedConcurrentDelta];
  }

  console.log(`    observed (real execution):`);
  for (const delta of observedForReconciliation) {
    console.log(`      ${delta.kind.padEnd(9)} ${delta.path}: ${fmt(delta.before)} -> ${fmt(delta.after)}`);
  }

  const reconciliation = reconcile(projectedForReconciliation, observedForReconciliation);
  printReconciliation(reconciliation);

  const rollback = testCase.adapter.proposeRollback(observedDeltas, worldBeforeThisWrite);
  printRollbackProposal(rollback);

  let rollbackClaimHolds = true;
  switch (testCase.rollbackPolicy) {
    case "unused":
      console.log(`    rollback executed: NO — reconciliation confirmed, so the pipeline never calls applyDeltas here.`);
      break;
    case "not-applicable":
      console.log(`    rollback executed: N/A — unavailable, nothing to run.`);
      break;
    case "propose-only":
      console.log(`    rollback executed: NO — whether to run it is a trust-gate/escalation decision this demo deliberately does not make (see .genesis/decisions/0005-domains.md).`);
      break;
    case "execute": {
      if (rollback.kind !== "runnable") {
        console.log(`    rollback executed: NO — expected runnable, got ${rollback.kind}.`);
        rollbackClaimHolds = false;
        break;
      }
      if (testCase.rollbackHonestyCheck === "verify-honest-inversion") {
        const honest = verifyStepsAreHonestInversion(observedDeltas, rollback.steps);
        console.log(`    honesty check (verifyStepsAreHonestInversion): ${honest ? "PASS" : "FAIL"}`);
        rollbackClaimHolds = rollbackClaimHolds && honest;
      }
      const options = testCase.rollbackHonestyCheck === "assume-no-concurrent-writer" ? { assumeNoConcurrentWriter: true } : undefined;
      const outcome = runRollback(rollback, worldAfterEverything, worldBeforeThisWrite, options);
      console.log(`    rollback executed: YES — outcome: ${outcome.status}`);
      if (outcome.status === "restored") {
        console.log(`      restored.fingerprint    = ${outcome.world.fingerprint}`);
        console.log(`      worldBeforeThisWrite.fp = ${worldBeforeThisWrite.fingerprint}`);
        console.log(`      fingerprint match: ${outcome.world.fingerprint === worldBeforeThisWrite.fingerprint ? "YES" : "NO"}`);
        console.log(`      fullWorldRestorationVerified (deep-equal, no birthday bound — ADR 0004 Decision 6): ${outcome.fullWorldRestorationVerified}`);
        rollbackClaimHolds = rollbackClaimHolds && outcome.world.fingerprint === worldBeforeThisWrite.fingerprint;
        if (options?.assumeNoConcurrentWriter) {
          rollbackClaimHolds = rollbackClaimHolds && outcome.fullWorldRestorationVerified;
        }
      } else {
        rollbackClaimHolds = false;
      }
      break;
    }
  }

  const statusOk = reconciliation.status === testCase.expectedReconciliationStatus;
  const kindOk = rollback.kind === testCase.expectedRollbackKind;
  const ok = statusOk && kindOk && rollbackClaimHolds;
  console.log(`    expected: reconciliation=${testCase.expectedReconciliationStatus}, rollback=${testCase.expectedRollbackKind}  ->  ${ok ? "PASS" : "FAIL"}`);
  console.log("");

  reconciliationStatusesSeen.add(reconciliation.status);
  rollbackKindsSeen.add(rollback.kind);
  return ok;
}

const reconciliationStatusesSeen = new Set<Reconciliation["status"]>();
const rollbackKindsSeen = new Set<Rollback["kind"]>();

function main(): number {
  console.log(DIVIDER);
  console.log("M6 DOMAIN DEMO — four domains, one engine, no domain-owned reconciliation or trust-gate logic");
  console.log(DIVIDER);
  console.log("");

  let failures = 0;
  const byDomain = new Map<string, DomainCase[]>();
  for (const testCase of ALL_CASES) {
    const bucket = byDomain.get(testCase.domainName) ?? [];
    bucket.push(testCase);
    byDomain.set(testCase.domainName, bucket);
  }

  for (const [domainName, cases] of byDomain) {
    console.log(`DOMAIN: ${domainName}`);
    console.log("");
    for (const testCase of cases) {
      if (!runCase(testCase)) failures++;
    }
  }

  console.log(DIVIDER);
  console.log(`SUMMARY: ${ALL_CASES.length} cases across ${byDomain.size} domains, ${ALL_CASES.length - failures} passed, ${failures} failed`);
  console.log(`  Reconciliation statuses observed: ${[...reconciliationStatusesSeen].sort().join(", ")}`);
  console.log(`  Rollback kinds observed:          ${[...rollbackKindsSeen].sort().join(", ")}`);

  const REQUIRED_STATUSES: ReadonlyArray<Reconciliation["status"]> = ["confirmed", "drifted", "unprojected"];
  const REQUIRED_KINDS: ReadonlyArray<Rollback["kind"]> = ["runnable", "unavailable"];
  const missingStatuses = REQUIRED_STATUSES.filter((s) => !reconciliationStatusesSeen.has(s));
  const missingKinds = REQUIRED_KINDS.filter((k) => !rollbackKindsSeen.has(k));

  console.log(DIVIDER);

  if (failures > 0) {
    console.log(`FAILED: ${failures} case(s) did not match their own declared expectation.`);
    return 1;
  }
  if (missingStatuses.length > 0 || missingKinds.length > 0) {
    console.log(`FAILED: coverage incomplete. Missing statuses: [${missingStatuses.join(", ")}], missing kinds: [${missingKinds.join(", ")}].`);
    return 1;
  }
  console.log("All cases produced their expected outcome. All three Reconciliation statuses and both Rollback kinds observed. OK.");
  return 0;
}

process.exit(main());
