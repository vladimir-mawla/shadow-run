# PLAN — shadow-run

The machine-parseable implementation plan. Mirrors the milestone table in `DONE.html` (DONE.html is the
human/visual view; this is the one loops read). Sliced so each milestone ships in one L1 BUILD pass.

> Slicing rule: a milestone must have (a) a single clear outcome, (b) an exact **demo command** that
> proves it, and (c) a freeze boundary of files it may touch. If you can't write the demo command,
> the milestone is too vague — split it.

This plan is scoped from `sim-plan.md` (the full scoping document produced before any code was written).
Section references below (§A.2, §A.4, §B, etc.) point into that document.

---

## Brainstorm (G0.5 — the make-or-break question, filled before slicing milestones)

> Three fundamentally different approaches to where a projection comes from. Pick one. Record the
> rationale. See `sim-plan.md` §A.2 for the full argument; summarized here for the plan to be self-contained.

### Approach A — Ask an LLM to narrate the likely outcome
Trivial, flexible across arbitrary domains.
- **Rejected outright:** this is precisely the disqualified "prompt wrapper with no system behind it." An
  LLM's guess is not a typed value, cannot be diffed against reality by machine, and its failure mode (a
  plausible-sounding wrong answer) is invisible until a human reads it.

### Approach B — Real transactional replay
Actually perform the write inside a transaction, inspect the effect, then roll the transaction back before
returning.
- **Strengths:** perfectly accurate by construction — it isn't a *prediction*, it's the real operation,
  discarded.
- **Weaknesses:** only exists for actions with a true transactional substrate. Most of what makes this
  domain interesting (sending a notification, calling a third-party API) has no such substrate — an
  approach that only works for the easy case would collapse back to "predict, don't execute" for exactly
  the cases that matter most.

### Approach C — Domain-supplied pure shadow-execution function
Every domain contributes a deterministic `project(action, world): ProjectedEffect` — the same
state-transition logic the real executor runs, factored so the mutating step operates on a cloned `World`
and returns a diff instead of committing it. No model call is reachable from this function; its type
signature has no slot for one.
- **Strengths:** structurally, not by promise, excludes "ask a model to guess" — `lib/simulate/**` will be
  grep-tested (M3) to contain zero LLM-client and zero network imports, the same discipline as
  decision-engine's `no-bare-threshold.test.ts`.
- **Weaknesses:** more upfront design work per domain; a domain must actually mirror its own real mutation
  logic rather than getting it "for free" from a transactional substrate.

### Chosen: C, with B folded in as an implementation strategy where a transactional substrate genuinely
exists (§A.2). The outward contract never changes — every domain's `project()` returns a typed
`ProjectedEffect`, full stop — but a domain sitting on a real transactional store may implement `project()`
by literally starting a transaction, applying the real write, reading the delta, and rolling back. That is
not cheating: a discarded real transaction *is* a valid, maximally accurate shadow execution.

---

## Milestones

### M1 — Contracts: World, ProjectedEffect, Reconciliation, Rollback
- **Outcome:** The four irreducible types (`sim-plan.md` §A.5) that every later milestone imports and none
  redefines: `World<TState>`, `ProjectedEffect`, `Reconciliation`, `Rollback` — plus the supporting
  `AssumptionKind` closed enum and `SimulatorTrust` shape. Nothing here simulates, reconciles, or rolls back
  anything for real — this milestone is the vocabulary everything else speaks.
- **Phase (swe-master):** BUILD
- **Files / freeze boundary:** `lib/contracts/**`. Frozen after this milestone — every later milestone
  imports these types, none redefines them.
- **Demo command:** `npm test -- contracts`
- **Success criteria:**
  - `@ts-expect-error` proofs that a `Rollback.runnable` literal missing `steps`, or an `unavailable`
    literal missing `reason`, does not compile.
  - `Reconciliation`'s three statuses exhaustively matched via an `assertNeverReconciliation` helper, with a
    test that a fourth status would fail to compile until handled everywhere.
  - `World.data` must be plain, serializable data — no functions. Enforced in the type system as far as
    TypeScript allows (a `Json`-constrained type parameter), and tested at runtime (a value that defeats the
    type system via a cast is still caught).
  - `ProjectedEffect.assumptions` is `ReadonlyArray<AssumptionKind>`, a closed, engine-defined enum — not
    free text. No field on `ProjectedEffect` may accept a value a model's prose could occupy without a type
    error (`assumptions` and `producedBy` both proved).
- **Loops:** L1, L4
- **Token budget:** 150000

### M2 — Deploy a live skeleton to Vercel
- **Outcome:** A minimal Next.js app with a health endpoint, deployed, with a real public URL — deliberately
  second, not last (a live URL left to the end is how it fails to happen; see the account's own standing
  note on this).
- **Phase:** DEPLOY
- **Files:** `app/api/health/**`, `vercel.json`, `next.config.*`, `package.json`
- **Demo command:** `curl -sf $DEPLOY_URL/api/health`
- **Success criteria:** HTTP 200, JSON body naming the deployed commit SHA. Uses `next dev/build --webpack`
  plus `experimental.extensionAlias` for the `.js`-suffixed NodeNext imports (Turbopack cannot resolve
  them) — `next.config.ts`'s reconciliation comment is copied from decision-engine, not rediscovered.
  **Needs a Vercel account.**
- **Loops:** L1, L4
- **Token budget:** 150000

### M3 — The shadow-execution engine (`simulate()`)
- **Outcome:** `simulate(action, world, adapter)` — the make-or-break layer from §A.2. No later milestone
  may add a model call anywhere under it.
- **Phase:** BUILD
- **Files:** `lib/simulate/**`. Frozen after this milestone.
- **Demo command:** `npm test -- simulate`
- **Success criteria:** the suite proves (a) `simulate()` is pure — identical input, deep-equal output on
  repeat calls; (b) it never mutates the input `World` (deep-freeze the input, assert a mutation attempt
  throws rather than silently succeeding); (c) a grep-based architectural test asserts zero
  `fetch`/LLM-client/`node:` imports anywhere under `lib/simulate/**`, mirroring decision-engine's
  `no-bare-threshold.test.ts` discipline.
- **Loops:** L1, L4
- **Token budget:** 150000

### M4 — Reconciliation and the trust feedback loop
- **Outcome:** The mechanical predicted-vs-observed diff (§A.3), and the reset-on-success `SimulatorTrust`
  counter with a real, provable threshold flip — divergence has a *consequence*, not just a log line.
- **Phase:** BUILD
- **Files:** `lib/reconcile/**`. Frozen after this milestone.
- **Demo command:** `npm test -- reconcile`
- **Success criteria:** identical predicted/observed deltas reconcile to `confirmed`; a single mismatched
  field reconciles to `drifted` naming the exact expected/actual `Delta`; an observed delta absent from the
  projection reconciles to `unprojected`; feeding a sequence of reconciliations through `SimulatorTrust`'s
  counter mechanically flips a `requiresPreValidatedRollback` (or equivalent) boolean at the exact
  configured threshold — a test checks counter value N-1 doesn't flip it, N does, and a single intervening
  `confirmed` resets the counter to `0` rather than merely slowing its climb (never an EMA — see §A.3).
- **Loops:** L1, L4
- **Token budget:** 150000

### M5 — Rollback engine: compensations that actually run
- **Outcome:** `invertDelta` and the one generic `applyDeltas` interpreter (§A.4) — the engine-owned code
  that turns a `Rollback.runnable`'s recorded `steps` into an actual, verified restoration.
- **Phase:** BUILD
- **Files:** `lib/rollback/**`. Frozen after this milestone.
- **Demo command:** `npm test -- rollback`
- **Success criteria:** `invertDelta` is total and correct for all four `Delta.kind` values (apply a delta,
  then its inverse, and get back the original `World.data` exactly); running `applyDeltas` with a
  `runnable` rollback's recorded `steps` against the real post-action `World` produces a `World` whose
  `fingerprint` equals the pre-action `World.fingerprint` — real hash equality, computed by really invoking
  the interpreter, never asserted; a domain declaring `unavailable` is a valid, well-typed, tested outcome
  (not a crash, not a fabricated `steps` array).
- **Loops:** L1, L4
- **Token budget:** 150000

### M6 — Domains: four adapters wired to simulate → execute → reconcile → rollback
- **Outcome:** The four domains from §D (calendar reschedule, inventory reservation, outbound notification,
  infra resize), each contributing only `project()`, `applyReal()`, and (where applicable)
  `proposeRollback()` — never reconciliation or trust-gate logic.
- **Phase:** INTEGRATE
- **Files:** `domains/**`, `scripts/demo-domains.ts`. Frozen after this milestone.
- **Demo command:** `npm run demo:domains`
- **Success criteria:** the script runs realistic synthetic cases through all four domains and prints, per
  case, the projected delta, the observed delta, the `Reconciliation` status, and the `Rollback` outcome;
  all three `Reconciliation` statuses and both `Rollback` kinds each appear at least once across the run.
- **Loops:** L1, L4
- **Token budget:** 150000

### M7 — The failure suite (the one deliberate-failure milestone)
- **Outcome:** The required deliberate-failure test for the shared deliverables, plus the plan's own named
  failure modes.
- **Phase:** VERIFY
- **Files:** `tests/failures/**`. Frozen after this milestone.
- **Demo command:** `npm test -- failures`
- **Success criteria:** at minimum — (1) the TOCTOU case from §B, asserted to reconcile as `drifted` and
  auto-derive/auto-apply the inverted `steps` via `applyDeltas`; (2) a domain whose `project()` is
  deliberately wrong (always predicts a no-op), asserted to be caught by `SimulatorTrust`'s counter within a
  documented, honestly-stated number of executions — name the lag, don't hide it; (3) `applyDeltas` throwing
  partway through a `steps` list, asserted to surface as an explicit `RollbackFailed` state, never silently
  swallowed as success; (4) a hash collision / stale-`World`-version case, resolved fail-closed toward
  `unavailable`/escalate, never toward a silent `execute`.
- **Loops:** L1, L4
- **Token budget:** 150000

### M8 — The interactive demo
- **Outcome:** The §B scenario, live: a clean run (confirmed, rollback unused) and an "inject concurrent
  change" run (drifted, auto-rollback, hash equality proven on screen) — both driving the real engine, never
  UI-side scripted.
- **Phase:** BUILD
- **Files:** `app/**`, `components/**`. Frozen after this milestone.
- **Demo command:** the deployed URL runs the §B scenario end-to-end from a click.
- **Success criteria:** on the deployed URL, both buttons drive a real `simulate → execute → reconcile →
  rollback(if triggered)` pass through the actual engine; the drifted field name and the before/after
  fingerprint equality are both rendered on screen; a stranger with no narration can see what happened and
  why. **Needs a Vercel account** (reuses M2's deployment).
- **Loops:** L1, L4
- **Token budget:** 150000

### M9 — Deliverables
- **Outcome:** Architecture snapshot (World → ProjectedEffect → Reconciliation → Rollback, mirroring the
  sibling docs' stage-by-stage "what does it refuse, and why" structure), the ≤300-word two-year thesis, and
  a verified clean-clone run.
- **Phase:** RELEASE
- **Files:** `docs/**`, `README.md`. Frozen after this milestone.
- **Demo command:** `cd "$(mktemp -d)" && git clone https://github.com/vladimir-mawla/shadow-run . && npm ci && npm run typecheck && npm test`
- **Success criteria:** a fresh clone, install, typecheck, and full test run all pass with zero credentials
  configured; the architecture snapshot and thesis exist in `docs/`, checked against actual code/test output
  before being committed — not asserted uncritically, per the "don't restate limits more strongly than
  they're true" discipline already in standing use on this account.
- **Loops:** L1, L4
- **Token budget:** 150000

---

## Progress (loops append here on milestone completion — newest last)

- M1 (L1 BUILD): `lib/contracts/**` implemented — `World`/`Json`/`isPlainData`/`assertPlainData` (world.ts),
  `computeFingerprint` (fingerprint.ts), `Delta` (delta.ts), `AssumptionKind`/`ProjectedEffect`
  (projected-effect.ts), `Reconciliation`/`assertNeverReconciliation` (reconciliation.ts), `Rollback`
  (rollback.ts), `SimulatorTrust` (simulator-trust.ts). One verified, deliberate deviation from the plan's
  A.5 sketch: `ProjectedEffect`/`Rollback` are NOT parametrized by `TState` (unlike `World<TState>`) because
  no field of either actually depends on the state's shape, and this project's `noUnusedLocals` tsconfig
  setting makes an unused type parameter a real compile error (TS6196), not a style nit — see
  `.genesis/decisions/0001-contracts.md`. `npm test -- contracts`: 7 test files, 42 tests, all passing.
  `npm run typecheck` clean on both tsconfigs. `npm run build` succeeds. Awaiting independent (L4)
  verification — not marked done in `DONE.html`.
- M2 (L1 BUILD): `app/api/health/route.ts` added — `force-dynamic` + Node.js runtime, reports
  `VERCEL_GIT_COMMIT_SHA` (falls back to `"unknown (local dev)"`, never a fabricated SHA, when unset), and
  runs a real check against M1's frozen `lib/contracts` (`computeFingerprint` key-order independence,
  `assertPlainData` actually rejecting a function-bearing value at runtime) rather than a bare liveness
  ping — adapted from decision-engine's `app/api/health/route.ts`, scoped down to what M1 actually built
  (no `lib/simulate`/`lib/reconcile`/`lib/rollback` exist yet). `app/milestones.ts` +
  `app/milestones.test.ts` added (the drift-guard mechanism, copied from decision-engine): zero milestones
  are marked `done` in either place, matching `DONE.html`'s own all-`todo` status table — `app/page.tsx`
  rewritten to read progress from that module instead of hardcoded prose, and now says plainly that no
  simulator/reconciliation/rollback engine exists yet. `next.config.ts` (already present from the M1
  repo-setup commit) had its worked-example comment corrected to reference this repo's own
  `lib/contracts`/`app/api/health` verification instead of decision-engine's cost-model wording, which had
  been carried over verbatim and no longer matched what this repo actually contains. No `vercel.json` added
  — Next.js zero-config detection is sufficient, matching decision-engine's own precedent of not adding one.
  `npm ci`: clean install, rolldown binding survives. `npm run typecheck`: clean, both tsconfigs.
  `npm test`: 8 test files, 44 tests, all passing. `npm run build` (`next build --webpack`) succeeds;
  `/api/health` resolves as a dynamic (ƒ) route, not statically prerendered. `npm run dev` + `curl` verified
  both the local-dev fallback (`"commit":"unknown (local dev)"`) and the Vercel-style path
  (`VERCEL_GIT_COMMIT_SHA` set to the real HEAD SHA, reported verbatim). `git diff main -- lib` empty —
  frozen boundary untouched. **Deployment itself has not happened** — the Vercel import is a human step this
  agent cannot perform; the repo is import-ready and the PR names the exact steps. Not marked done in
  `DONE.html`, and cannot be until a real `$DEPLOY_URL` answers the demo command.
