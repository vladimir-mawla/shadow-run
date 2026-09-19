# CURRENT
- active_loop: M1 (contracts — the first milestone on `.genesis/PLAN.md`), branch `main`, built from a fresh
  repo (no prior history). This is the repo's first commit sequence — there is no earlier milestone to have
  frozen anything yet.
- target: the four irreducible types from `sim-plan.md` §A.5 (`World<TState>`, `ProjectedEffect`,
  `Reconciliation`, `Rollback`) plus the supporting `AssumptionKind` closed enum and `SimulatorTrust` shape,
  all under `lib/contracts/**` — nothing else. No `simulate()`, no domains, no UI.
- what actually shipped: `lib/contracts/world.ts` (`World`, `Json`, `isPlainData`/`assertPlainData`,
  `NonPlainDataError`), `lib/contracts/fingerprint.ts` (`computeFingerprint` — FNV-1a over canonicalized
  JSON, dependency-free), `lib/contracts/delta.ts` (`Delta`), `lib/contracts/projected-effect.ts`
  (`AssumptionKind`, `ProjectedEffect`), `lib/contracts/reconciliation.ts` (`Reconciliation`,
  `assertNeverReconciliation`), `lib/contracts/rollback.ts` (`Rollback`), `lib/contracts/simulator-trust.ts`
  (`SimulatorTrust`), `lib/contracts/index.ts` (barrel). One real ADR,
  `.genesis/decisions/0001-contracts.md`.
- verified, not merely claimed: `npm run typecheck` (both `tsconfig.lib.json` and `tsconfig.json`) exits 0
  with zero errors — including every `@ts-expect-error` directive in the test suite actually guarding a real
  compile error (an unused `@ts-expect-error` is itself a `tsc` error, `TS2578`, so a clean typecheck is
  proof the negative-compile tests are real, not decorative). `npm test -- contracts` (and plain `npm test`)
  runs 7 test files, 42 tests, all passing. `npm run build` (`next build --webpack`) succeeds with the
  minimal app/ shell in place. `npm ci` (after the one `npm install` that generated the lockfile) reproduces
  the same green state, and the rolldown native binding survives it on this machine.
- one deliberate, recorded deviation from the plan's own A.5 sketch: `ProjectedEffect` and `Rollback` are
  NOT parametrized by `TState` (unlike `World<TState>`), because neither type's fields actually depend on
  the state's shape and this project's `noUnusedLocals` tsconfig setting (matching decision-engine's own
  strictness) makes an unused type parameter a real compile error, confirmed directly against this repo's
  `tsc`, not assumed. Recorded in ADR 0001, Decision 3.
- not done: `lib/contracts/**` is frozen as of this commit sequence per its own freeze boundary, but M1 is
  NOT marked `done` in `DONE.html` — that happens only after independent (L4) verification, per this
  account's standing rule. Independent (L4) verification has since run and approved the milestone's content,
  but held it at not-done pending fixes to findings raised during that review (see the `m1-fixes` branch/PR
  and its commits for what changed and why); M1 is marked `done` only once those fixes land and are folded
  back into this checkpoint.
- PR history, corrected: the PR opened for M1 (`m1-contracts-final`, #1) is CLOSED, not open — it was an
  artifact of a repo-setup error (`gh repo create --source=.` pushed M1's commits directly to `main` before
  a feature-branch flow existed), and its own closing comment on GitHub explains why merging it would have
  achieved nothing (`main` already carried the identical content). `main` is the default branch and carries
  M1's real history directly; there is no open PR for M1 itself. (The stale "the PR is open, not merged"
  line this replaces was accurate the day it was written and became wrong the moment #1 was closed — a
  checkpoint that names which PR, and its current state, doesn't have that failure mode.)
