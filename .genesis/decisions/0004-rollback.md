# ADR 0004 — The rollback engine: what `invertDelta`/`applyDeltas` actually prove, what they don't, and what a rollback restores to

- **Date:** 2026-09-20
- **Status:** accepted
- **Phase / milestone:** M5 (BUILD) — `lib/rollback/`

## Context

M1's ADR (`.genesis/decisions/0001-contracts.md`) froze `Delta`, `Rollback`, and `computeFingerprint`, and handed M5 two open questions by name rather than leaving them to be rediscovered: (1) whether fingerprint equality is strong enough to serve as PROOF, not just a cheap drift check, once its 32-bit birthday bound is a real risk; and (2) — surfaced mid-build, by the M6 design work, not by M1 — exactly what a rollback restores **to**, once a concurrent actor is allowed to touch the same `World.id` between an action and its rollback. Both are answered here, together, because the second question changes the honest answer to the first.

`sim-plan.md` §A.4 sketches `invertDelta` and says `applyDeltas` is "the exact same generic interpreter M3/M4 use to apply deltas forward," but does not fully specify the interpreter's apply semantics, order of application, atomicity, or restoration target. Those are this milestone's to decide, canonically, and this ADR is where the reasoning lives — `lib/rollback/path.ts`, `apply-deltas.ts`, `invert-delta.ts`, and `run-rollback.ts` each carry pointers back here rather than repeating the argument.

## Decision 1 — `Delta.before`/`after` are whole-value SNAPSHOTS at `path`, for all four `kind`s, not element-level edits

**Alternatives considered:**

- **Element-level operations** — `append`'s `before`/`after` hold a single collection element (the thing added), `remove`'s hold the thing deleted. This is the more literal reading of `delta.ts`'s own prose ("append... its inverse is a remove of the same value"). **Rejected**: applying it requires the interpreter to know WHICH occurrence to touch when a collection has duplicate values, and WHERE an appended element landed — exactly the ambiguity this milestone's own design questions name ("does inverting append need to know how many elements were appended, or where?"). Resolving that would need either an index field `Delta` (frozen) does not have, or a bigger, JSON-Patch-style vocabulary — precisely the "expression language nobody asked for" `delta.ts`'s own header already rejected once for `Delta.kind` itself.
- **Chosen: whole-value snapshots.** `before` is the exact value found at `path` immediately before the change; `after` is the exact value found immediately after — for `set`/`increment` this is what one would expect anyway; for `append`/`remove` it means the FULL collection (or field), not a single element. This sidesteps the ambiguity completely: there is no "which occurrence" question, because the exact resulting state is what got recorded, not a description of the edit that produced it. It also means applying ANY `Delta`, regardless of `kind`, is ONE uniform rule (`path.ts`, `apply-deltas.ts`): verify the current value at `path` deep-equals `before`, then write `after`. `kind` is never inspected by the interpreter at all — it exists only for `invertDelta` (which does branch on it, to choose an honest relabeling) and for M4's reconciler (recognizing "additive" vs "overwrite" drift, `delta.ts`'s own stated rationale, out of this milestone's scope).
- **Cost, named plainly:** a `Delta` for a large collection's `append`/`remove` carries the whole collection twice. Cheap for this project's four domains (an outbox, a participant list); would not scale to an unbounded collection, and this ADR does not pretend otherwise.

This is fully consistent with M1's own frozen fixture (`lib/contracts/__tests__/delta.test.ts`): `{ path: "c", before: 1, after: undefined, kind: "remove" }` and `{ path: "d", before: undefined, after: 1, kind: "append" }` — `undefined` standing for "the field did not exist" — exactly the whole-snapshot, `undefined`-for-absence convention this decision formalizes, not a new invention layered on top of it.

## Decision 2 — `invertDelta` is total, and why: it never inspects the payload's type

Given Decision 1, inverting any `Delta` is always exactly one of two pure relabelings, and BOTH are total regardless of what `before`/`after` actually contain:

1. **Swap, same `kind`** (`set`, `increment`) — a snapshot swap never inspects whether the value is a number, string, object, or `undefined`.
2. **Swap and relabel** (`remove` → `set`, `append` → `remove`) — still a pure swap; only the `kind` string changes, chosen so the inverted delta's label honestly describes what running it does (reintroducing a value is a `set`; undoing an addition is a `remove`).

**Named case: `increment` on a non-numeric payload.** This milestone's own design questions ask directly what happens here. Answer: nothing special, because `invertDelta` never does arithmetic — it swaps opaque `unknown` values. A REJECTED alternative design inverted `increment` by negating a numeric delta amount (`after - before`); that design would have a real failure case here (no defined negation of a non-numeric "amount"). Rejecting it is exactly what buys totality. `invert-delta.test.ts` proves this directly with a string-valued `increment` Delta.

**What is NOT total, named so it is never confused with a gap in `invertDelta`:** whether the RESULTING inverted `Delta` applies cleanly against a given `World.data` is a different question `invertDelta` cannot answer — it only transforms the `Delta` value, which never fails. Applying it (`applyDeltas`) is where a real mismatch surfaces, loudly, as a thrown error — never silently. See Decision 4.

**Not an involution across kind changes.** `invertDelta(invertDelta(x)) === x` holds for `set`/`increment` (the label never changes) but NOT for `remove`/`append`, because inverting a `remove` produces a `set`, and inverting THAT `set` produces another `set`, not the original `remove` — `invertDelta` is a correct involution on the `(before, after)` payload, never on the full `(kind, before, after)` triple. `invert-delta.test.ts` records this directly so a future reader does not mistake it for a bug.

## Decision 3 — Order: `steps` are built from the REVERSED observed sequence, not the plan sketch's literal `.map(invertDelta)`

`sim-plan.md` §A.4 writes `steps` as `observedEffect.deltas.map(invertDelta)`, with no reversal. That literal reading breaks the moment one action produces more than one `Delta` touching the same `path` (two appends to the same outbox within one notification batch, say): forward deltas `[D1, D2]` took the world `base → D1 → D1,D2`; undoing that must walk back through the SAME intermediate state in reverse — `invert(D2)` first (valid against the `D1,D2` state, which is what the real post-action `World` actually is), then `invert(D1)`. Applying `invert(D1)` first demands a `D1`-only state that was never independently captured; `apply-deltas.ts`'s per-step verification correctly rejects it, but it is an avoidable, wrong failure on an otherwise-valid rollback plan.

**Chosen:** `buildRollbackSteps` (`run-rollback.ts`) reverses `observedDeltas` before mapping `invertDelta`. This is standard undo-log discipline (LIFO), not merely "the obvious choice" — it is the ONLY order under which a multi-step rollback touching overlapping state can succeed at all. `__tests__/run-rollback.test.ts`'s "order" suite proves both directions concretely: reversed order restores correctly; the literal, unreversed plan-sketch order throws.

## Decision 4 — Atomicity: `applyDeltas` throwing partway never returns, and never mutates, a half-restored `World`

The single most dangerous state this milestone's own brief names: "`applyDeltas` throws partway through a `steps` list; the world is then half-restored." **Chosen:** `applyDeltas` builds a private `structuredClone` of `world.data` and mutates ONLY that scratch copy, step by step. If any step's verification fails, it throws immediately; the scratch copy — however far it got — is discarded with it. There is no code path that returns a `World` reflecting some but not all of `deltas`, and the input `world` argument is never touched (it is already deep-frozen by `makeWorld` regardless). Proved directly in `apply-deltas.test.ts`: a deliberately-failing step 2 of 3, asserting the ORIGINAL `world` argument is provably unchanged afterward, and that the thrown `RollbackStepFailedError` names the exact failing step index and `Delta`.

**Rejected alternative:** catch-and-return-partial-with-a-warning-flag. Rejected because a caller checking `status` before reading `data` is one bug away from treating a half-restored `World` as real state; a thrown error with no returned `World` at all cannot be misread that way even by a careless caller.

`wouldApplyCleanly` (`apply-deltas.ts`) is added as an explicitly-named, non-throwing wrapper for a caller who wants to ask "would this succeed?" as vocabulary rather than writing its own `try`/`catch` — it is NOT a separate safety mechanism; `applyDeltas` already carries zero risk to real state on failure, so asking first and running for real are equally safe, just differently named.

## Decision 5 — What does a rollback restore **to**? (raised by M6, resolved here)

Two candidates exist for the rollback target, and they are not the same `World`:

- **(a) The simulation snapshot** — the `World` `simulate()` (M3) projected against, captured before the action ran.
- **(b) The state immediately before THIS action's own write** — which can differ from (a) if another actor writes to the same `World.id` between simulation and execution (the plan's own headline TOCTOU scenario, §B).

**Chosen: (b).** **Rejected (a), with the consequence spelled out rather than left implicit:** if a concurrent write lands between simulate and execute, and rollback restores all the way back to the STALE simulation snapshot, it does not merely undo this action — it SILENTLY ERASES the other actor's legitimate write. That is data loss dressed as a successful rollback, and it is exactly the failure a judge (or a real user) would find first in the scenario this project's own demo is built to showcase.

This is not merely a policy choice layered on top of already-built code — it is structurally what `buildRollbackSteps` already does, and could not do otherwise: it only ever inverts `observedDeltas`, THIS action's own real before/after pair at each `path` it touched, and never receives or references a simulation snapshot at all. `Rollback`'s own frozen doc comment (`lib/contracts/rollback.ts`) already says this obliquely — "`Rollback` is per-execution and per-instance... the exact steps that will restore THIS write" — "this write," not "the simulation." Choosing (b) here makes that reading explicit rather than assumed.

**The correctness claim changes shape — stated precisely, not left implicit.** Under (b), "the whole world returns to the fingerprint it had at simulation time" is not merely unproven in general — it can be FALSE FOR A GOOD REASON (a concurrent write legitimately happened, and rollback correctly left it alone). What `runRollback` proves BY DEFAULT is narrower and always true regardless of concurrent writers: **every `path` this rollback's `steps` touch now holds exactly the value it held immediately before this action's own write; every path it does not touch was never read or written by this call at all.** That is exactly what `applyDeltas` completing without error already means — no further whole-`World` comparison is attempted by default, because attempting one would assert the WRONG, stronger claim. `__tests__/run-rollback.test.ts`'s "concurrent writer" suite proves this directly: a concurrent append to a different path survives rollback intact, and the test computes what comparing to the stale snapshot WOULD have shown (a mismatch) to demonstrate concretely why that comparison is the wrong one to make, not merely assert it.

**The opt-in strong claim, for when it IS valid.** `runRollback(rollback, worldToRestore, worldBeforeThisWrite, { assumeNoConcurrentWriter: true })` additionally asserts the full-`World` claim — `deepEqual(restored.data, worldBeforeThisWrite.data)` — but ONLY when the caller supplies this flag, naming the exact assumption already given a name elsewhere in this codebase (`AssumptionKind: "no-concurrent-writer"`, `lib/contracts/projected-effect.ts`). This is criterion 2's own literal demo scenario (`__tests__/run-rollback.test.ts`'s "no concurrent writer" suite) and is where this milestone's fingerprint-equality proof lives — see Decision 6.

## Decision 6 — Fingerprint equality vs. structural deep-equality (ADR 0001's forward note, answered)

ADR 0001 handed this forward explicitly: `computeFingerprint` is a 32-bit FNV-1a change detector, and once fingerprint equality is asked to serve as PROOF rather than a cheap drift check, its birthday bound is real — collisions become roughly as likely as not once ~77,000 distinct compared values have been hashed against each other (`2^16 · sqrt(π/2)`), well within reach of a heavily-exercised demo. Two options were offered: (a) name a sample-count ceiling and accept the risk above it, or (b) widen `computeFingerprint` — the orchestrator's call, since it means editing frozen `lib/contracts/fingerprint.ts`.

**Chosen: neither (a) nor (b) alone — a third option, staying inside this milestone's own freeze boundary.** `runRollback`'s opt-in strong check (Decision 5) has the REAL pre-write `World.data` and the REAL restored `World.data` sitting in memory — both were already necessary to build and to run the rollback in the first place. Given that, `deepEqual` on `data` is STRICTLY STRONGER than fingerprint equality and has NO birthday bound at all: two values either are structurally identical or they are not; there is no hash space to collide in. `dataMatchesExactly` (internal to `runRollback`) is therefore the AUTHORITATIVE check the pass/fail decision is actually based on. `fingerprint` equality is still computed and reported alongside it — never as a substitute — for two honest reasons: (1) it is what criterion 2's own wording and this milestone's demo output are phrased around; (2) `computeFingerprint` is a pure function of `data`, so `dataMatchesExactly ⇒ fingerprintMatches` is a mathematical guarantee, and `runRollback` asserts this explicitly (throwing an internal-invariant error if it is ever violated) rather than silently trusting it.

**The ceiling is not eliminated — it is relocated and named for whoever needs it.** A hypothetical caller with only a bare fingerprint on hand — no retained `World.data`, e.g. a long-lived audit store that discards full snapshots to save space — cannot use the strong path this milestone builds. For that caller, ADR 0001's original number still applies exactly as stated: fingerprint-alone equality stops being trustworthy as proof past ~77,000 compared values, and a system built that way must accept that risk by name or widen `computeFingerprint`. This milestone does not build that caller and does not soften the number for it — it is recorded here as a forward note, the same courtesy ADR 0001 extended to this milestone.

## Decision 7 — Verifying honesty before running: two checks, kept separate, neither mistaken for the other

**Question posed:** can the engine verify a `runnable` rollback is honest before running it, rather than discovering failure afterward?

- **Cheap self-consistency check (always performed, before anything runs):** does `rollback.projectedRestoration.resultingFingerprint` already disagree with `worldBeforeThisWrite.fingerprint`? `ProjectedEffect` (frozen) has no field carrying a full snapshot, so this is necessarily fingerprint-vs-fingerprint — the only version of this particular check available — and it stays valid under a concurrent writer because both sides describe the SAME, earlier moment. It is a SNIFF TEST, not a proof: passing it means the rollback's paperwork agrees with what is expected, not that its `steps` actually produce that result.
- **The real proof:** actually run `applyDeltas`. There is no cheaper way to know for certain — `applyDeltas`'s own per-step verification IS the check, and because it never mutates its input and never returns a partial result (Decision 4), calling it once "to see" carries zero risk beyond CPU time. "Dry run" and "the real run" are the identical function call.
- **A THIRD, always-valid check, added specifically for the concurrent-writer discussion:** `verifyStepsAreHonestInversion(observedDeltas, steps)` (`run-rollback.ts`) independently recomputes `buildRollbackSteps(observedDeltas)` and compares it to the recorded `steps` with `deepEqual`. This never looks at "the world" at all, so nothing about a LATER concurrent write can make it wrong — it answers "did whoever built this `Rollback` actually invert their own observed effect honestly," which is exactly what would have caught the `wrongButCleanSteps` case in `__tests__/run-rollback.test.ts` without needing the `assumeNoConcurrentWriter` assumption at all. It is not wired into `runRollback` as a requirement because `Rollback` (frozen) does not itself carry `observedDeltas` — only a caller or verifier who separately retained both values can use it, which this milestone does not assume is always true.

## Consequences

- Positive: `invertDelta`/`applyDeltas` are correct and total under a definition of "total" that is honest about what it does and does not cover (kind coverage, not payload-type coverage) — see Decision 2.
- Positive: rollback under concurrent writers fails closed (never overwrites a path a concurrent actor has since touched) and never silently erases a concurrent actor's write to a path it doesn't touch — see Decisions 4–5, proved directly in `__tests__/run-rollback.test.ts`.
- Positive: the fingerprint ceiling ADR 0001 named is not inherited as risk in this milestone's own scope — Decision 6.
- Negative / cost: the default (`runRollback` with no options) proves a narrower claim than criterion 2's literal wording ("fingerprint equals the pre-action fingerprint") once a concurrent writer is in play — that literal claim is now only asserted, and only made, under the opt-in `assumeNoConcurrentWriter` flag, in the scenario where it is actually true. A reader expecting the strong claim unconditionally must read this ADR to understand why it isn't offered unconditionally.
- Negative / cost: `verifyStepsAreHonestInversion`, the one always-valid honesty check under concurrent writers, requires retaining `observedDeltas` alongside `Rollback.steps` — something `Rollback`'s own frozen shape does not require of a caller. Whichever milestone or verifier wants this check must retain both by its own discipline.
- Forward note for M6 — **this is a requirement, not a preference.** Independent verification built the
  exploit: a fabricated step `{path:"stock.reserved", before:42, after:41}` applies cleanly against a real
  post-action world, and `runRollback` with no options returns `status:"restored"` with the value at 41 —
  the wrong value, reported as success. The default path cannot catch this, by construction, and nothing in
  the type system forces a caller to look. So **every M6 call site must take one of the two available
  honesty checks**: `assumeNoConcurrentWriter: true` where no concurrent writer is possible, or an explicit
  `verifyStepsAreHonestInversion(observedDeltas, steps)` where one is. Taking neither is not a style
  choice — it is accepting a success report that may be false.
  To make the second option available at all, domains constructing a `Rollback.runnable` must retain
  `observedDeltas` alongside the derived `steps` in whatever record they keep; `Rollback`'s frozen shape
  does not carry them, so M5 cannot enforce this and M6 must do it by discipline. A verifier reviewing M6
  should treat a call site that takes neither check as a finding.
- Forward note for M3/M4 merge: `lib/rollback/path.ts` duplicates forward-delta-application logic M3's own `lib/simulate/path.ts` independently implements (M3's own notes flag this). This file is the canonical version per plan §A.4; resolving the duplication is for whichever loop merges M3 and M5, not this one — M3 is on a separate, unmerged branch as this is written, so there is nothing to reconcile against yet.

## Alternatives rejected (summary, cross-referenced above)

- Element-level `append`/`remove` semantics (Decision 1) — reintroduces the "which occurrence, where" ambiguity `Delta.kind`'s own design already avoided once.
- Negating a numeric `increment` amount instead of swapping snapshots (Decision 2) — breaks totality on non-numeric payloads for no benefit.
- The plan sketch's literal, unreversed `steps = observedDeltas.map(invertDelta)` (Decision 3) — fails on any action with overlapping-path deltas.
- Catch-and-return a partial `World` with a warning flag on rollback failure (Decision 4) — one careless read away from treating corrupted state as real.
- Restoring to the simulation snapshot (Decision 5, option (a)) — silently erases a concurrent actor's legitimate write.
- Asserting whole-`World` fingerprint/deep-equality unconditionally (Decision 5/6) — false for a good reason under a legitimate concurrent write; only valid, and only asserted, under the named `assumeNoConcurrentWriter` opt-in.
- Widening `computeFingerprint` now (Decision 6, ADR 0001's option (b)) — not this milestone's file to touch; not needed given the opt-in deep-equality path.

<!-- Copy this file to NNNN-<slug>.md for each irreversible decision.
     Then add a one-line pointer in wiki/index.md if it becomes something later milestones need to find. -->
