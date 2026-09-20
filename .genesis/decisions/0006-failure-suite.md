# ADR 0006 — The failure suite (M7, partial): what each case pins, what it deliberately does not, and what the design doc got stale

- **Date:** 2026-09-20
- **Status:** accepted (partial — cases 1 and 5 outstanding, pending M6)
- **Phase / milestone:** M7 (VERIFY) — `tests/failures/**`

## Context

`m7-failure-suite.md` (`/private/tmp/.../scratchpad/m7-failure-suite.md`, written before M3 and M5 merged) designed five cases against PLAN.md's M7 success criteria. This build implements the three that need only `lib/contracts/**`, `lib/simulate/**`, `lib/reconcile/**`, and `lib/rollback/**` — all real and frozen on this branch — and deliberately leaves out Case 1 (needs M6's inventory domain for the TOCTOU §B scenario) and Case 5 (needs a real M6 call site to prove the trust gate is actually consulted, not merely computed). Per the build brief: **cases 1 and 5 are not stubbed, not skipped, and carry no placeholder assertion.** A test that passes without testing anything is worse than an absent one, so nothing under `tests/failures/**` mentions either case.

## What each built case pins

**Case 2 (`case-2-wrong-project.test.ts`) — full pin, runnable today.** A fake adapter satisfying M3's real, frozen `SimulationAdapter<TState>` interface, always predicting a no-op (`deltas: []`, `resultingFingerprint` copied unchanged), driven through the real `simulate()`, real `reconcile()`, and the real `SimulatorTrust` counter (`lib/reconcile/trust.ts`) for `DEFAULT_TRUST_THRESHOLD` (today: **3**, imported, never hardcoded) consecutive real executions. Pins:

- Every one of this domain's real executions reconciles as `"unprojected"` (never `"confirmed"`, never `"drifted"`) — decidable mechanically from `reconcile.ts`'s own pass-2 logic, and now confirmed by actually running it.
- The lag: exactly `DEFAULT_TRUST_THRESHOLD` real, wrongly-simulated executions ship — with their real consequences already landed — before `requiresPreValidatedRollback` returns anything but `false`.
- The favorable edge: once flipped, this domain's gate never resets (an always-empty prediction can never produce `"confirmed"`).
- The harder truth, named rather than buried: this is the detector's BEST case, not a representative one — a domain that occasionally reconfirms resets the counter and restarts the full grace period; an alternating domain never trips the gate at all (`simulator-trust.ts`'s own accepted cost, reused here, not re-argued).

**Case 3 (`case-3-partial-rollback-failure.test.ts`) — full pin, runnable today** (the design doc labelled this "not yet pinnable — prescriptive"; see the stale-parts section below for why that was wrong). Pins:

- `applyDeltas` throwing on a middle step (index 1 of 3) and, independently, on the last step (index 2 of 3) — both leave the original `World` object byte-for-byte unchanged (asserted by object identity, not merely `toEqual`), never a half-restored result.
- The thrown `RollbackStepFailedError` names the exact failing step index, delta, and what was actually found — never a bare "rollback failed."
- "Nothing applied because a step was invalid" (`RollbackOutcome.status === "failed"`, no `World` reachable on that branch at all — a compile-time guarantee, not just a runtime one) is structurally distinguishable from "nothing needed doing" (`status === "restored"` for a genuine `steps: []` no-op) — different named members of the same real union, never conflated.

**Case 4 (`case-4-hash-collision.test.ts`) — full pin for 4a/4b; honest partial pin for 4c.** Uses the real, independently-reverified collision (`computeFingerprint({reserved: 412789})` and `computeFingerprint({reserved: 649192})` both `2ba95242`), never mocked. Pins:

- The collision itself, and that fingerprint equality does not imply data equality.
- `reconcile()` immune (a real drift at the colliding field is still reported correctly, by value, never by hash).
- `SimulatorTrust` immune (its transition is identical for the collision-derived drift and an unrelated one — proving the arithmetic never sees the magnitude or "collision-ness" of the numbers).
- `checkConsistency` (M3) immune: an honest projection that legitimately lands on the colliding fingerprint is correctly accepted (the collision is irrelevant to its own correctness), and a dishonest one is still correctly rejected even though it claims the same "attractive" colliding value.
- `runRollback`'s stronger proof survives: a constructed case where a rollback lands on genuinely different data whose fingerprint nonetheless collides with the expected one is still correctly reported `"dishonest"`, never `"restored"` — proving `dataMatchesExactly` (`deepEqual`), not `fingerprintMatches`, drives that branch.
- 4c (stale `World.version`, fail-closed): **honest partial pin.** `AssumptionKind`'s `"world-version-unchanged"` member is real and frozen, but no gate function that consumes it exists anywhere in `lib/**` yet (confirmed by reading `lib/simulate/**`/`lib/reconcile/**` directly — `simulate()` never reads `World.version`, `reconcile()` never touches it either). This sub-case pins the required comparison via a small, test-local reference function built only from real primitives, and states plainly that it is a specification proof, not a production call-site proof — `lib/**` is frozen for this milestone, so a real gate cannot be added here even though it would be code, not prose.

## What none of the three cases claim

- Nothing here proves the collision is reachable at M6's real, multi-field `StockState` shape — only at the minimal `World<{ reserved: number }>` shape this codebase's own test fixtures already use.
- Case 4's immunity claims cover two different mechanisms, not one, and an earlier version of this line
  conflated them. `reconcile()` and `SimulatorTrust` are immune because they never touch a hash —
  neither `reconcile.ts` nor `trust.ts` imports `computeFingerprint`. `checkConsistency` is immune for the
  opposite reason: it imports `computeFingerprint` (`consistency.ts:1`) and calls it (line 100) to *derive*
  a fingerprint from real data and compare it against the claimed one, never trusting a claimed hash. The
  original "none of the three reads a fingerprint" phrasing was factually wrong about `checkConsistency`
  and would have led a reader to the opposite of how that case actually works. Caught by independent
  verification; the sub-tests themselves were correct throughout.
- Case 3 does not speculate about a forward-execution (`applyReal()`) failure mode — `applyDeltas` is the same interpreter for both directions, but M6's forward-execution wiring is out of scope here entirely.
- 4c's gate is a specification, not a shipped enforcement point — see above.

## Where the design doc (`m7-failure-suite.md`) was stale, and what's real instead

1. **Case 3's central premise was wrong.** The doc states `"RollbackFailed"`... does not exist anywhere on `main` today, not even as a sketch" and labels Case 3 "not yet pinnable... the weakest-grounded case in this suite." Both are false against the real, merged M5: `RollbackStepFailedError` (thrown, `lib/rollback/apply-deltas.ts:21`) and `RollbackOutcome.status === "failed"` (returned, `lib/rollback/run-rollback.ts`) are exactly the named failure shapes the doc predicted would need inventing, already built, with `stepIndex`/`delta`/`foundAtPath` — the "which step, what cause" shape the doc's own `MalformedDeltaArrayError` precedent argued for. Case 3 is a full pin, not the doc's prescriptive specification.
2. **The doc's own pin-status table undersold Case 2 not at all** — it called Case 2 "full pin, runnable today, no unmerged code needed," and that held up exactly as written once actually run.
3. **4c remains genuinely partial**, as the doc predicted, but for a sharper reason than "nothing exists to call": the gate's CONSUMER (M3's `simulate()` boundary, or M6/M8's wiring) is out of scope for M7 regardless of what merges, since `lib/**` is frozen this milestone. The doc's uncertainty about *whether* this would ever be pinnable was itself slightly pessimistic — the `AssumptionKind` member and the version-comparison rule are both real and specifiable today, just not as a `lib/**` call site.
4. **Everything else the doc stated as fact about `lib/contracts/**`/`lib/reconcile/**`** (the exact `Reconciliation`/`SimulatorTrust`/`Delta` shapes, `DEFAULT_TRUST_THRESHOLD`, `reconcile()`'s pass-1/pass-2 mechanics) was re-confirmed by reading the real, merged source directly before writing any test, and matched the doc's description in every case checked.

## Cases 1 and 5 — deliberately outstanding, pending M6

**Case 1** (the §B TOCTOU scenario: `reconcile` → `drifted` → auto-derived, auto-applied, hash-and-data-verified rollback) needs a real inventory `World`/`project()`/`applyReal()` sequence from M6 to be anything more than a hand-built fixture pretending to be a domain. Building it now would mean inventing the exact domain M6 owns, which the build brief explicitly forbids.

**Case 5** (the trust gate flipping but never being consulted, closing §E's third named risk) needs a real M6 call site that is supposed to check `requiresPreValidatedRollback` before permitting `applyReal()` to run. Nothing under `lib/**` today wires the gate to any execution path at all — there is no real caller to spy on, only a boolean this milestone can prove flips correctly (Case 2) without being able to prove anything downstream respects it.

Neither is stubbed, skipped, or given a vacuous assertion anywhere in `tests/failures/**`. Both remain fully described in `m7-failure-suite.md` for whichever loop merges M6 and picks this suite back up.
