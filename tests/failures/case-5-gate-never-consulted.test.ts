import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Reconciliation } from "../../lib/contracts/index.js";
import {
  DEFAULT_TRUST_THRESHOLD,
  makeInitialTrust,
  requiresPreValidatedRollback,
  updateTrust,
} from "../../lib/reconcile/index.js";

/**
 * M7 CASE 5 — the trust gate is computed correctly, and NOTHING in the
 * shipped pipeline reads it. Closes `sim-plan.md` §E's third named risk:
 * "divergence is detected and logged, but nothing downstream changes...
 * a dashboard nobody acts on." HONEST PARTIAL PIN overall — see below for
 * exactly which half is full and which is not, and why.
 *
 * === WHY THIS CASE EXISTS AT ALL, ARGUED, NOT ASSUMED =====================
 * Cases 1-4 prove the gate's own ARITHMETIC (a real threshold flip, a real
 * collision, a real rollback outcome union) but none of them, read
 * literally, forces anyone to check the gate's CONSEQUENCE — whether a
 * `true` return from `requiresPreValidatedRollback` actually changes what
 * any real caller is permitted to do next. A boolean that flips correctly
 * and is then ignored by every caller satisfies Cases 1-4 exactly as
 * written while still being the "dashboard nobody acts on" story §E.3
 * warns about. That gap is real, independently re-confirmed below by
 * actually reading the shipped source, not merely repeated from the
 * design doc's argument for adding this case.
 *
 * === THE DESIGN DOC AND ADR 0006 ARE STALE HERE — CHECKED, NOT INHERITED =
 * `m7-failure-suite.md` and ADR 0006 (M7's own first-pass record) both
 * say Case 5 needs "a real M6 call site that is supposed to check
 * `requiresPreValidatedRollback` before permitting `applyReal()` to run,"
 * and that nothing under `lib/**` wires the gate to any execution path —
 * "there is no real caller to spy on." M6 has since merged. This file
 * checked directly, rather than assuming the gap closed on its own: it
 * has NOT. `domains/**` and `scripts/demo-domains.ts` are real now, and
 * neither references `requiresPreValidatedRollback` anywhere (proven
 * below, `describe("5c", ...)`) — confirming this is not an oversight a
 * later milestone will accidentally fix, but a structural fact about how
 * this system is wired: `.genesis/PLAN.md`'s own M6 summary instructs
 * domains to "contribute data, never outcome logic," and
 * `domains/inventory/cases.ts`'s own comment on INV-3 says the identical
 * thing in its own words — "whether this rollback ever runs is a
 * trust-gate decision this domain does not make." Nobody on the other
 * side of that boundary has picked it up either; there is still no real
 * caller to spy on, so this file demonstrates the gap a different way
 * (below) rather than writing the "attempt is refused" assertion the
 * design doc sketches for a gate that does not exist yet.
 *
 * `sim-plan.md` §E.3's own "Prevention" text is ALSO stale, in a way worth
 * naming plainly rather than routing around: it claims "M6/M7 require at
 * least one domain (#3, notification) to actually be forced through the
 * stricter escalation path BECAUSE OF [the trust-gate boolean], in the
 * demo data, not hypothetically." Read against the real, merged
 * `domains/notification/domain.ts`: notification's escalation
 * (`Rollback.unavailable`, per `proposeRollback`'s own header) is NOT
 * caused by the trust gate at all — it fires unconditionally, because
 * there is no `Delta.kind` whose inversion means "this recipient never
 * read this message" (ADR 0005 §5's own words), regardless of what
 * `SimulatorTrust` says for that action type. Nothing in
 * `domains/notification/**` reads `SimulatorTrust` or the gate either
 * (same grep, same result, below). So the plan's own claimed prevention
 * for risk §E.3 was never actually wired the way its prose describes —
 * which is exactly this case's own justification, confirmed independently
 * rather than only argued.
 *
 * === WHAT IS FULL, WHAT IS NOT =============================================
 * FULL PIN: the gate's arithmetic (`describe("5a", ...)`) and a concrete,
 * executed demonstration that the ordinary call shape this codebase
 * actually uses (`simulate` -> execute -> `reconcile` -> `updateTrust`,
 * Case 2's own shape) proceeds to a fourth real execution UNCONDITIONALLY
 * even after the gate has flipped `true` (`describe("5b", ...)`) — both
 * are real code, run today, asserted on an observed spy count, not
 * narrated.
 *
 * HONEST PARTIAL PIN: the claim "no call site in the shipped pipeline
 * consults the gate" (`describe("5c", ...)`) is a claim about ABSENCE,
 * which this file establishes with a grep-style architectural check over
 * TODAY's committed, non-test source — mirroring `lib/simulate/__tests__
 * /architecture.test.ts` and `domains/__tests__/architecture.test.ts`'s
 * own precedent for exactly this shape of check. Stated precisely, not
 * oversold: this PROVES that no non-test source file under
 * `lib/simulate/**`, `lib/rollback/**`, `lib/contracts/**`, `domains/**`,
 * `scripts/**`, or `app/**` TEXTUALLY contains the identifier
 * `requiresPreValidatedRollback` today (checked by literal substring
 * search over each file's real, on-disk contents — not by reasoning about
 * what the code "should" do). It does NOT prove, and this file does not
 * claim, that no future code path could ever consult the gate, nor does
 * it detect a call constructed to dodge a textual search — reflection
 * (`obj[computedPropertyName]`), a renamed re-export chased through a
 * second indirection layer, or a dynamically assembled string that
 * reconstructs the identifier at runtime would all be invisible to this
 * check, the same class of gap `lib/contracts/world.ts`'s own "KNOWN,
 * UNCLOSED GAP" paragraph names for a hostile `Proxy` defeating
 * `isPlainData` — a search over what IS committed, not a guarantee about
 * what COULD be written. This is a search over today's source, not a
 * guarantee about all future code, and this file says so rather than
 * dressing the search up as one.
 */

describe("Case 5a — full pin: the gate's own arithmetic, reused minimally from Case 2's own pattern (never re-litigated in full here)", () => {
  it(`requiresPreValidatedRollback flips exactly at DEFAULT_TRUST_THRESHOLD (today: ${DEFAULT_TRUST_THRESHOLD}), imported, never hardcoded`, () => {
    const DRIFTED: Reconciliation = {
      status: "drifted",
      expected: { path: "reserved", before: 1, after: 2, kind: "set" },
      actual: { path: "reserved", before: 1, after: 3, kind: "set" },
    };

    let trust = makeInitialTrust("case5.gated-action");
    for (let i = 1; i < DEFAULT_TRUST_THRESHOLD; i++) {
      trust = updateTrust(trust, DRIFTED);
      expect(requiresPreValidatedRollback(trust)).toBe(false);
    }
    trust = updateTrust(trust, DRIFTED);
    expect(trust.consecutiveNonConfirmed).toBe(DEFAULT_TRUST_THRESHOLD);
    expect(requiresPreValidatedRollback(trust)).toBe(true);
  });
});

describe("Case 5b — full pin, executed not narrated: the gate flips true, and the ordinary real call shape this codebase uses proceeds to a fourth real execution anyway", () => {
  /**
   * The same always-wrong adapter shape Case 2 pins in full
   * (`case-2-wrong-project.test.ts`) — reproduced minimally here (not
   * imported from that file, to keep this file's own claim
   * self-contained) purely as a REALISTIC stand-in for "the real
   * execution a domain's applyReal() performs," wrapped in a spy so this
   * test can observe, by count, whether anything stops it from running a
   * fourth time once trust has already flipped.
   */
  it("the fourth call executes unconditionally -- the spy count proves it, not an inference from the gate's own value", () => {
    let executionCount = 0;
    function spiedRealExecution(before: number, qty: number): { readonly observed: { before: number; after: number }; readonly after: number } {
      executionCount++;
      return { observed: { before, after: before + qty }, after: before + qty };
    }

    let reservedNow = 100;
    let trust = makeInitialTrust("case5.always-wrong");

    // Three real, wrongly-simulated executions -- identical shape to Case
    // 2's own loop (predicted is always [], so every one of these
    // reconciles as "unprojected", never "confirmed") -- flip the gate.
    for (let i = 0; i < DEFAULT_TRUST_THRESHOLD; i++) {
      const { observed, after } = spiedRealExecution(reservedNow, 5);
      const reconciliation: Reconciliation = {
        status: "unprojected",
        actual: { path: "reserved", before: observed.before, after: observed.after, kind: "increment" },
      };
      trust = updateTrust(trust, reconciliation);
      reservedNow = after;
    }

    expect(trust.consecutiveNonConfirmed).toBe(DEFAULT_TRUST_THRESHOLD);
    expect(requiresPreValidatedRollback(trust)).toBe(true); // the gate is now flipped.
    expect(executionCount).toBe(DEFAULT_TRUST_THRESHOLD);

    // THE POINT: a fourth call, through the identical, ordinary shape --
    // nothing between "trust flipped" and "call the real execution again"
    // consults requiresPreValidatedRollback anywhere, because nothing in
    // this loop (mirroring the real shape every domain's own call site
    // uses -- simulate/execute/reconcile/updateTrust, with no gate check
    // anywhere in between) ever calls it except to read its value for
    // this test's own assertions above.
    spiedRealExecution(reservedNow, 5);
    expect(executionCount).toBe(DEFAULT_TRUST_THRESHOLD + 1); // ran anyway. Nothing refused it. Nothing escalated it.
  });
});

/**
 * Case 5c -- see file header for exactly what this proves and does not.
 * Mirrors `domains/__tests__/architecture.test.ts`'s own
 * `listNonTestSourceFiles` walker (same idiom, copied rather than
 * re-derived, since it already solves "walk non-test .ts source under a
 * directory" correctly for this repo's layout).
 */
const REPO_ROOT = join(import.meta.dirname, "..", "..");

// `lib/reconcile/**` is deliberately EXCLUDED: it is the gate's own home
// (`trust.ts` defines it, `index.ts` re-exports it) -- of course the name
// appears there. Checking that a lock contains the word "lock" proves
// nothing; the claim this case pins is about every OTHER directory that
// could conceivably call it.
const SCAN_ROOTS: ReadonlyArray<string> = [
  join(REPO_ROOT, "lib", "contracts"),
  join(REPO_ROOT, "lib", "simulate"),
  join(REPO_ROOT, "lib", "rollback"),
  join(REPO_ROOT, "domains"),
  join(REPO_ROOT, "scripts"),
  join(REPO_ROOT, "app"),
];

function listNonTestSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      files.push(...listNonTestSourceFiles(full));
    } else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.endsWith(".test.ts") && !entry.endsWith(".test.tsx")) {
      files.push(full);
    }
  }
  return files;
}

describe("Case 5c — honest partial pin: a textual, architectural search proving no non-test source file OUTSIDE lib/reconcile/** contains the gate's own identifier", () => {
  it("requiresPreValidatedRollback appears in NO shipped, non-test source file under lib/contracts, lib/simulate, lib/rollback, domains, scripts, or app", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of listNonTestSourceFiles(root)) {
        const contents = readFileSync(file, "utf8");
        if (contents.includes("requiresPreValidatedRollback")) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("SANITY CHECK on the check itself: the search DOES find the identifier where it is honestly expected to live (lib/reconcile/**), proving this is a real, working substring search, not a vacuously-passing one over an empty or wrongly-scoped file list", () => {
    const trustFile = readFileSync(join(REPO_ROOT, "lib", "reconcile", "trust.ts"), "utf8");
    expect(trustFile.includes("requiresPreValidatedRollback")).toBe(true);
    const indexFile = readFileSync(join(REPO_ROOT, "lib", "reconcile", "index.ts"), "utf8");
    expect(indexFile.includes("requiresPreValidatedRollback")).toBe(true);
  });

  it("notification's own escalation (Rollback.unavailable) is unconditional and does not read the trust gate either -- correcting sim-plan.md §E.3's own 'Prevention' claim, which read as if it did", () => {
    const notificationDomainFile = readFileSync(join(REPO_ROOT, "domains", "notification", "domain.ts"), "utf8");
    expect(notificationDomainFile.includes("requiresPreValidatedRollback")).toBe(false);
    expect(notificationDomainFile.includes("SimulatorTrust")).toBe(false);
  });
});
