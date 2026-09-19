# Plan: "Simulate Before You Act" — working name `shadow-run`

Scoping pass only. No repo created, no code written. Sibling projects read for context:
`~/Desktop/decision-engine` (branch `m9-deliverables`) and `~/Desktop/agent-trust-layer`.

## 0. What's quoted vs. inferred

The verbatim brief for this project is not recoverable. Everything below the title and the one-line
mechanic is either (a) directly given by the task instructions you handed me — the rubric, the shared
deliverables/disqualifiers, the house rules — or (b) my inference about what the *original, project-specific*
brief probably also said, filling the gap the same way the siblings' briefs evidently did. Check every item
in the second list against the real brief before treating it as a requirement rather than a design choice.

**Given verbatim (title + mechanic):**
- Title: "Simulate Before You Act."
- Mechanic: an agent projects the effects of an action before executing it, with a rollback path in front
  of every write.

**Given by your task instructions (not the brief, but not my inference either):** the shared rubric weights,
shared deliverables, shared disqualifiers, the ≥3-domains requirement, the M2-is-deploy / M8-is-demo /
M9-is-deliverables / exactly-one-failure-milestone conventions, the stack, and the "share infrastructure
only" constraint.

**My inferences about the project-specific brief — flagged, with recommendation:**
1. *"Before executing" implies the action still actually executes.* I'm assuming this is a simulate → gate →
   execute → reconcile pipeline, not a simulate-only tool that never touches real state. Recommendation:
   build it this way — a simulator nobody ever executes against is unfalsifiable, which is exactly the
   "story generator" failure mode named in your brief for this plan. If the real brief meant simulation-only,
   this over-delivers rather than under-delivers.
2. *"A rollback path in front of every write" means the write is gated on rollback existing*, not merely
   that rollback is offered as a side option after the fact. This is the single biggest interpretive call in
   this plan — see §A.4. Recommendation: gate it (stricter reading), because the weaker reading ("rollback is
   available if you want it") makes rollback decorative and is indistinguishable from a prompt wrapper that
   just prints "this can be undone."
3. *Reconciliation (checked-against-reality) and a feedback consequence on divergence are required*, not just
   "nice to have." Nothing in the title says this explicitly — it follows from your instruction that "a
   simulator never checked against reality is a story generator." Recommendation: treat it as load-bearing;
   it is most of what makes this project's technical-depth score defensible.
4. *All demo domains are self-contained, in-memory, and synthetic* — no real external API calls (no real
   email provider, no real payment rail). Inferred for demo determinism and repeatability under the
   deploy-once, judge-clicks-it-later constraint. If the original brief wanted a live third-party
   integration, this under-delivers on realism but over-delivers on reliability; I recommend the safer
   choice for a judged, unattended demo.

---

## A. The conceptual spine

### A.1 — What is a simulation here, mechanically?

A simulation is **shadow execution**: running the same effect logic the real write would run, but against a
*cloned* copy of the current state, so its mutation never escapes to the real world. It consumes:

- an `Action` (what's proposed — domain, type, parameters; deliberately not this project's job to score its
  cost or reversibility class, that question belongs to the decision-engine sibling and is explicitly not
  re-implemented here — see §A.4 on why rollback is a stronger, different claim),
- a `World<TState>` (a typed, versioned, hashed snapshot of exactly the state slice the action touches).

It produces a `ProjectedEffect<TState>` — **a typed array of field-level deltas and a predicted resulting
hash, never a sentence.** Every field in the type, including `assumptions` (see A.5 — a closed, engine-
defined enum, not a string), is a value a model's prose cannot occupy without a type error. That's
deliberate and enforced (see A.2).

### A.2 — Where does the projection come from? (the make-or-break question)

**Three approaches considered, one chosen** (same brainstorm-then-pick discipline the siblings used):

**Approach A — Ask an LLM to narrate the likely outcome.**
Trivial, flexible across arbitrary domains. Rejected outright: this is precisely the disqualified "prompt
wrapper with no system behind it." An LLM's guess is not a typed value, cannot be diffed against reality by
machine, and its failure mode (a plausible-sounding wrong answer) is invisible until a human reads it.

**Approach B — Real transactional replay: actually perform the write inside a transaction, inspect the
effect, then roll the transaction back before returning.**
Strengths: perfectly accurate by construction — it isn't a *prediction*, it's the real operation, discarded.
Weaknesses: only exists for actions with a true transactional substrate (a SQL engine, in-memory data with
snapshot/restore). Most of what makes this domain interesting — sending a notification, calling a third-party
API, anything with an external side effect — has no such substrate. An approach that only works for the easy
case would collapse back to "predict, don't execute" for exactly the cases the rubric's "technical depth" and
"failure thinking" criteria are going to probe hardest.

**Approach C — Domain-supplied pure shadow-execution function.**
Every domain contributes a deterministic `project(action, world): ProjectedEffect` — **the same state-
transition logic the real executor runs**, factored so the mutating step operates on a cloned `World` and
returns a diff instead of committing it. No model call is reachable from this function; its type signature
has no slot for one.

**Chosen: C, with B folded in as an *implementation strategy* where a transactional substrate genuinely
exists.** The outward contract never changes — every domain's `project()` returns a typed `ProjectedEffect`,
full stop — but a domain that happens to sit on a real transactional store is free to implement its own
`project()` by literally starting a transaction, applying the real write, reading the resulting delta, and
rolling back before returning. That's not cheating; a discarded real transaction *is* a valid, maximally
accurate shadow execution, and using it where it's available is strictly better than reinventing the same
logic twice. Domains with no such substrate (send-a-notification, call-a-third-party) implement `project()`
as a hand-written pure mirror of the real mutation instead. Either way, the survives-the-objection answer is
structural, not a promise: **`lib/simulate/**` is grep-tested to contain zero LLM-client and zero network
imports** (the same discipline as decision-engine's `no-bare-threshold.test.ts`), so "you're just asking a
model to guess" is falsifiable and false by construction, not by assertion.

### A.3 — What makes a projection wrong, and how does the system find out?

A projection is wrong when the **observed** effect of the real execution doesn't match the **predicted**
one. Reconciliation is mechanical, not judged:

1. Before real execution: snapshot `World` (with its hash) and run `project()` → `ProjectedEffect`.
2. Execute the real write for real, against the real `World`.
3. Snapshot the real post-write `World` (with its hash) → derive the `ObservedEffect` (the same `Delta[]`
   shape, computed the same mechanical way `project()` computes it, from the two real snapshots — no
   judgment call either).
4. Diff `ProjectedEffect.deltas` against `ObservedEffect` field-by-field → a `Reconciliation`:
   - `confirmed` — every predicted delta matches an observed one, hash-for-hash.
   - `drifted` — a field the projection named came back with a different value than predicted (names the
     exact field, expected, actual).
   - `unprojected` — the real execution changed something the projection never predicted at all.

Divergence isn't just logged — it has a **consequence**, which is what keeps this from becoming a checked-but-
inert story generator: each domain/action-type carries a `SimulatorTrust` value —
**a plain consecutive-non-`confirmed` counter, not an EMA** (a design correction from an earlier draft of
this plan, which described both a decaying average *and* a clean threshold-flip test for it in the same
breath; those are two different statistics and don't share that property — see the note below). Every
`confirmed` reconciliation resets the counter to `0`; every `drifted`/`unprojected` reconciliation increments
it. When the counter reaches a fixed threshold, the gate mechanically flips: that action type's future
simulate-then-execute pipeline is forced into a stricter mode (require the compensating rollback to be
pre-validated, or require human sign-off, before the real write runs).

**Why a counter, not an EMA, and why this isn't just a relabeling.** An EMA *can* be made to have an exact,
computable crossing point for a fixed sequence and decay rate — the objection to it isn't that it's
unfalsifiable, it's that (a) replaying it requires replaying the *entire* reconciliation history through the
same recurrence, not just the current value, which is a heavier and less legible audit story than this
project needs, and (b) a decaying average that a `confirmed` result only partially forgives makes the "N-1
doesn't flip, N does" test itself sequence-dependent in a way that's harder to state and to verify
independently. A plain reset-on-success counter keeps the exact same guarantee ("the same identical input
sequence flips at the same identical step, every time, and a test asserts step N-1 doesn't and step N does")
with no recurrence to replay — the counter's current value is fully reconstructable from "how many
reconciliations back was the last `confirmed`," which is the same kind of small, replayable fact this
project already leans on for `Rollback` (see A.4). The cost, stated plainly: a domain that's flaky in an
alternating way (confirmed, drift, confirmed, drift, ...) never trips the gate under a reset-on-success
counter, where a non-resetting or EMA-style statistic eventually would. That's a real trade, not a free
lunch — accepted here because a hackathon-scale demo needs the threshold behavior to be something a judge
or an independent verifier can compute in their head from the sequence on screen, not something that needs
the decay-rate constant to check.

### A.4 — The rollback path, as a type — and why it's a stronger claim than reversibility

The decision-engine sibling has four **reversibility levels** — a static classification of an action *type*,
used only to compute how much confidence is required before acting. This project does not reuse that, and
reusing it would be the shallow move: reversibility answers "in principle, could this be undone," which is a
property you can assert without ever running anything. Rollback here is defined as **a compensating operation
that actually runs and is verified to restore prior state** — provable, not asserted.

**Correction from an earlier draft of this plan, caught before any code was written.** That draft typed the
runnable case as `{ kind: "runnable"; compensate: (world: World<TState>) => World<TState>; ... }` — a
closure. That is the exact mistake the decision-engine sibling already made and reversed: `Prohibition.matches`
was originally a predicate closure, found unserializable, and forced its own M5 audit trail to record
prohibitions by id and require the caller to re-supply the real predicate at replay time
(`lib/decide/prohibition.ts`; `.genesis/decisions/0003-audit-model.md`). ADR 0004 then made the same call for
`ValueConstraint` — data, not a closure — specifically to avoid reproducing that wart "one layer down." A
`Rollback` that carries a function has the identical defect, and it's worse here: rollback is the single
claim in this whole project most worth auditing ("I undid it" is a claim about the past a judge should be
able to replay), and a closure cannot be recorded into that record, cannot be replayed against it, and
cannot be compared for equality against what a verifier expects it to do.

**The fix, following the sibling's exact pattern (data + a small, engine-owned, generic interpreter, never a
per-case closure):** a compensating operation is represented as the *same* `Delta` type `ProjectedEffect`
already uses, inverted. The engine owns one small, total, enumerable function —

```ts
// Engine-owned, lib/rollback/**, the ONLY place a Delta is inverted. Mirrors lib/signals/constraint.ts's
// evaluateConstraint: a small closed switch over Delta.kind, not a domain-supplied predicate.
function invertDelta(delta: Delta): Delta {
  switch (delta.kind) {
    case "set":       return { ...delta, before: delta.after, after: delta.before };
    case "increment": return { ...delta, before: delta.after, after: delta.before };
    case "remove":    return { ...delta, kind: "set",    before: delta.after, after: delta.before };
    case "append":    return { ...delta, kind: "remove", before: delta.after, after: delta.before };
  }
}

// Also engine-owned: the one interpreter that ever mutates a World, forward or in reverse.
function applyDeltas<TState>(world: World<TState>, deltas: ReadonlyArray<Delta>): World<TState> { /* ... */ }
```

`Rollback<TState>` becomes:

```ts
type Rollback<TState> =
  | { kind: "runnable";    steps: ReadonlyArray<Delta>; projectedRestoration: ProjectedEffect<TState> }
  | { kind: "unavailable"; reason: string; blastRadius: ReadonlyArray<Delta> }
```

`steps` is `observedEffect.deltas.map(invertDelta)` — a plain, serializable array of the same `Delta` values
already flowing through the system, computed once by the engine and then *recorded verbatim*. Executing a
rollback is `applyDeltas(mutatedWorld, rollback.steps)`, the same generic interpreter M3/M4 already use to
apply deltas forward — never a bespoke per-case function. This buys back everything the closure gave up:
`steps` can be written into the audit-style record next to the `World` it applied to, a verifier can literally
re-run `applyDeltas(recordedPreWorld, recordedSteps)` and diff the result against what was claimed, and two
rollbacks can be compared for equality with `deepEqual`, not `Function.prototype.toString()`-scraping.

A domain cannot construct `steps` for an effect that has no real inverse at all (the notification domain
below: there is no `Delta` whose inversion means "the recipient never read the email"). For those, the domain
adapter declares `unavailable` with a named `reason` and a `blastRadius` — still data, never a fabricated
`steps` array that would apply cleanly against `World.data` while lying about the real world. Per the
inference in §0.2, the gate is: **a write with an `unavailable` rollback cannot pass through `execute`
silently; it requires an explicit escalation (a human sign-off token) before the real write runs.** This is
the rollback path being "in front of" the write, literally — it's consulted before the write is permitted,
not offered as a courtesy after.

### A.5 — The irreducible types (four)

```ts
// 1. World<TState> — a typed, addressable, versioned, hashed snapshot of the state slice an action touches.
interface World<TState> {
  readonly id: string;          // stable identity of the resource/aggregate
  readonly domain: string;      // "inventory" | "calendar" | "notification" | ...
  readonly version: number;     // monotonic sequence for this id
  readonly at: string;          // ISO-8601 instant this snapshot was captured
  readonly data: TState;        // domain-typed, plain-data state — no functions, nothing unserializable
  readonly fingerprint: string; // pure hash of `data` — the thing exact-equality checks compare
}

// 2. ProjectedEffect<TState> — a typed diff. Never a sentence.
interface ProjectedEffect<TState> {
  readonly deltas: ReadonlyArray<Delta>;
  readonly resultingFingerprint: string;         // predicted post-action hash
  readonly assumptions: ReadonlyArray<AssumptionKind>; // closed, engine-defined enum — see note below
  readonly producedBy: "shadow-execution";       // provenance tag — structurally, not by claim
}
// A small, closed, ENGINE-defined vocabulary — not a domain-extensible string, and never free text.
// Mirrors ValueConstraint's own "operator set chosen deliberately, kept deliberately small" discipline
// (decision-engine ADR 0004): the projection can only ever cite one of these named preconditions, so
// "there is no free-text field a model's prose could occupy" is true of the WHOLE type, not true of
// every field except this one.
type AssumptionKind = "no-concurrent-writer" | "world-version-unchanged" | "clock-monotonic";
interface Delta {
  readonly path: string;                                  // e.g. "stock.reserved"
  readonly before: unknown;
  readonly after: unknown;
  readonly kind: "set" | "increment" | "remove" | "append";
}

// 3. Reconciliation — predicted vs. observed, the falsifiability mechanism.
type Reconciliation =
  | { status: "confirmed";   matched: ReadonlyArray<Delta> }
  | { status: "drifted";     expected: Delta; actual: Delta }
  | { status: "unprojected"; actual: Delta };

// 4. Rollback<TState> — a compensating operation that actually runs, or a named reason it can't.
// `steps` is DATA (an inverted Delta list), executed by the one engine-owned `applyDeltas` interpreter —
// never a closure. See A.4 for why (this is the exact mistake decision-engine's ADR 0004 already caught
// and reversed for ValueConstraint, applied here to Rollback).
type Rollback<TState> =
  | { kind: "runnable";    steps: ReadonlyArray<Delta>; projectedRestoration: ProjectedEffect<TState> }
  | { kind: "unavailable"; reason: string; blastRadius: ReadonlyArray<Delta> };
```

A fifth, supporting (not irreducible) type: `SimulatorTrust` — `{ actionType: string; consecutiveNonConfirmed:
number; totalObserved: number }`, the reset-on-success counter described in A.3 (not an EMA — see that
section for why the two are different mechanisms and only one is kept). It's derived from the `Reconciliation`
history, not independent, so it doesn't count against the four.

---

## B. The one thing a judge will remember

**Run the same reservation action twice, live, on the deployed demo.** First run: simulate → the projected
delta is shown → execute → the observed delta is captured → `Reconciliation: confirmed` → no rollback needed,
shown greyed out as "available but unused." Second run: before the judge clicks "execute," the demo lets them
click "inject concurrent change" — a second, invisible actor mutates the same World between simulation and
execution (a real TOCTOU race, not a scripted lie). The system executes, reconciles, and **live on screen**
names the exact field that drifted (`stock.reserved: predicted 42, observed 45`), automatically derives and
applies the `runnable` rollback's recorded `steps` (the inverted deltas, run through the one generic
`applyDeltas` interpreter — not a bespoke undo routine), and shows the restored World's fingerprint matching
the pre-action fingerprint hash-for-hash. The recorded `steps` array is also shown, so the judge can see
the exact data the interpreter executed, not just the claim that something ran. One sentence: *the same
action, run twice — once where reality matched the simulation and rollback sat unused, once where a
concurrent write made reality diverge, and the system caught the exact diverged field, derived the exact
compensating deltas, and proved, by hash equality, that applying them actually undid the write.* A prompt
wrapper cannot do this: there's no typed delta to diff, no real mutation to have raced against, and nothing
that literally re-runs, from a recorded, replayable data value, to prove the undo worked.

---

## C. Milestones M1–M9

Each is built by one agent (L1 BUILD) and independently verified by a different one (L4 VERIFY) before being
marked done, per the sibling projects' own standing rule — the independent verifier's first job on every
milestone is confirming the freeze boundary wasn't touched.

### M1 — Contracts: World, ProjectedEffect, Reconciliation, Rollback
- **Freeze boundary:** `lib/contracts/**` becomes immutable after this milestone; every later milestone
  imports these types, none redefines them.
- **Demo command:** `npm test -- contracts`
- **Success criteria:** the suite proves the four types compile as discriminated unions where applicable
  (`@ts-expect-error` proofs that a `Rollback.runnable` literal missing `steps`, or an `unavailable`
  literal missing `reason`, does not compile); `Reconciliation`'s three statuses are exhaustively matched
  via an `assertNeverReconciliation` helper with a test that a fourth status added later fails to compile
  until handled everywhere.

### M2 — Deploy a live skeleton to Vercel
- **Freeze boundary:** none rescinded; adds `app/api/health/**`, `vercel.json`, `next.config.*`,
  `package.json` only. Deployed at milestone 2, deliberately — never last.
- **Demo command:** `curl -sf $DEPLOY_URL/api/health`
- **Success criteria:** HTTP 200, JSON body naming the deployed commit SHA. Uses `next dev/build --webpack`
  plus `experimental.extensionAlias` for the `.js`-suffixed NodeNext imports, per house rules — copy the
  sibling's `next.config.ts` reconciliation comment rather than rediscovering it. **Needs a Vercel account.**

### M3 — The shadow-execution engine (`simulate()`)
- **Freeze boundary:** `lib/simulate/**` frozen after this milestone. This is the make-or-break layer from
  §A.2 — no later milestone may add a model call anywhere under it.
- **Demo command:** `npm test -- simulate`
- **Success criteria:** the suite proves (a) `simulate(action, world, adapter)` is pure — called twice with
  identical input, deep-equal output; (b) it never mutates the input `World` (deep-freeze the input, assert a
  mutation attempt throws rather than silently succeeding); (c) a grep-based architectural test asserts zero
  `fetch`/LLM-client/`node:` imports anywhere under `lib/simulate/**`, mirroring decision-engine's
  `no-bare-threshold.test.ts` discipline.

### M4 — Reconciliation and the trust feedback loop
- **Freeze boundary:** `lib/reconcile/**` frozen.
- **Demo command:** `npm test -- reconcile`
- **Success criteria:** the suite proves identical predicted/observed deltas reconcile to `confirmed`; a
  single mismatched field reconciles to `drifted` naming the exact expected/actual `Delta`; an observed delta
  absent from the projection reconciles to `unprojected`; and — the feedback part — feeding a sequence of
  reconciliations for one action type through `SimulatorTrust`'s consecutive-non-`confirmed` counter (never
  an EMA — see A.3) mechanically flips a `requiresPreValidatedRollback` (or equivalent) boolean at the exact
  configured threshold, asserted by a test that checks counter value N-1 doesn't flip it, N does, and a
  single intervening `confirmed` resets the counter to `0` rather than merely slowing its climb.

### M5 — Rollback engine: compensations that actually run
- **Freeze boundary:** `lib/rollback/**` frozen.
- **Demo command:** `npm test -- rollback`
- **Success criteria:** the suite proves `invertDelta` is total and correct for all four `Delta.kind` values
  (a round trip — apply a delta, then apply its inverse — returns the original `World.data` exactly); that
  running the generic `applyDeltas` interpreter with a `runnable` rollback's recorded `steps` against the
  real post-action `World` produces a `World` whose `fingerprint` equals the pre-action `World.fingerprint` —
  actual hash equality, computed by really invoking the interpreter on real recorded data, never asserted;
  and that a domain declaring `unavailable` is a valid, well-typed, tested outcome (not a crash, not a
  fabricated `steps` array that would apply without error while lying about what it restores).

### M6 — Domains: four adapters wired to simulate → execute → reconcile → rollback
- **Freeze boundary:** `domains/**`, `scripts/demo-domains.ts`. Domains contribute only `project()`,
  `applyReal()`, and (where applicable) a `proposeRollback()` — never reconciliation or trust-gate logic,
  exactly the "domains as data adapters, not outcome logic" discipline decision-engine used.
- **Demo command:** `npm run demo:domains`
- **Success criteria:** the script runs realistic synthetic cases through all four domains (see §D) and
  prints, per case, the projected delta, the observed delta, the `Reconciliation` status, and the `Rollback`
  outcome; asserts all three `Reconciliation` statuses and both `Rollback` kinds each appear at least once
  across the full run.

### M7 — The failure suite (the one deliberate-failure milestone)
- **Freeze boundary:** `tests/failures/**`.
- **Demo command:** `npm test -- failures`
- **Success criteria:** at minimum — (1) the TOCTOU case from §B, asserted to reconcile as `drifted` and
  auto-derive and auto-apply the inverted `steps` via `applyDeltas`; (2) a domain whose `project()` is
  deliberately wrong (always predicts a no-op regardless of the real mutation) — asserted to be caught by
  `SimulatorTrust`'s counter within a documented, *honestly stated* number of executions, not instantly
  (name the lag, don't hide it); (3) `applyDeltas` throwing partway through a `steps` list — asserted to
  surface as an explicit `RollbackFailed` state, never silently swallowed as success; (4) a hash collision /
  stale-`World`-version case, resolved fail-closed toward `unavailable`/escalate, never toward a silent
  `execute`. This is the **required deliberate failure test** for the shared deliverables.

### M8 — The interactive demo
- **Freeze boundary:** `app/**`, `components/**`.
- **Demo command:** the deployed URL runs the §B scenario end-to-end from a click.
- **Success criteria:** on the deployed URL, the "clean run" and "inject concurrent change" buttons each
  drive a real `simulate → execute → reconcile → rollback(if triggered)` pass through the actual engine (no
  UI-side scripting of the outcome); the drifted field name and the before/after fingerprint equality are
  both rendered on screen; a stranger with no narration can see what happened and why. **Needs a Vercel
  account** (reuses M2's deployment).

### M9 — Deliverables
- **Freeze boundary:** `docs/**`, `README.md`.
- **Demo command:** `cd "$(mktemp -d)" && git clone https://github.com/<account>/shadow-run . && npm ci && npm run typecheck && npm test`
- **Success criteria:** a fresh clone, install, typecheck, and full test run all pass with zero credentials
  configured; the architecture snapshot (World → ProjectedEffect → Reconciliation → Rollback, mirroring the
  sibling docs' stage-by-stage "what does it refuse, and why" structure) and the ≤300-word two-year thesis
  exist in `docs/`, checked against actual code/test output before being committed — not asserted
  uncritically, per the "don't restate limits more strongly than they're true" discipline already in
  standing use on this account.

---

## D. The domains (four, chosen to stress different parts of the mechanic)

1. **Calendar reschedule** (deterministic, no contention). Baseline case: proves the round trip works when
   nothing goes wrong — `confirmed` reconciliation, rollback available but unused. Stresses: correctness of
   the happy path, nothing else.
2. **Inventory reservation** (concurrency / partial compensation). Two actors can reserve the same stock
   pool; the demo's TOCTOU scenario lives here. Stresses: real concurrent mutation between simulate and
   execute, and a rollback that may only be *partially* effective (units already resold to someone else can't
   be un-sold — the domain's `steps` encode only the best achievable restoration, and the residual gap is
   itself a named `Delta`, not hidden).
3. **Outbound notification** (no rollback possible). Sending a message has no compensating operation.
   Stresses: the `unavailable` branch of `Rollback`, and the execute-gate from §A.4 — this domain is the one
   that must escalate rather than silently execute when trust is unproven.
4. **Infra resize / feature-flag rollout** (technically reversible, but slow and costly to compensate — e.g.
   restoring a downsized resource takes real time). Stresses: a `runnable` rollback whose
   `projectedRestoration` isn't instantaneous or free, forcing the trust/gate logic to weigh compensation
   cost, not just its existence — the case where "reversible in principle" (decision-engine's classification)
   and "cheaply rollback-able in practice" (this project's claim) visibly diverge.

Three domains would satisfy the house minimum; the fourth is recommended because #1–#3 alone leave "rollback
exists but is expensive/slow" untested, and that's a distinct failure mode from "rollback doesn't exist at
all" (#3) — collapsing them would make #4's lesson invisible.

---

## E. Risks — three ways this becomes a prompt wrapper with extra steps

1. **Risk: the projection quietly becomes "ask a model to guess and format it as JSON."** Easy to slide into
   once a domain's real logic is hard to mirror by hand. **Prevention:** the M3 freeze plus the grep-based
   architectural test (zero LLM-client/network imports under `lib/simulate/**`) makes this a build failure,
   not a code-review judgment call — it's checked by the same mechanism decision-engine used for its
   no-bare-threshold rule, which already survived independent verification once.
2. **Risk: rollback is a label, not an operation** — `Rollback.runnable` gets built but its `steps` are never
   actually run through `applyDeltas` anywhere except a mocked unit test that doesn't touch real mutated
   state. **Prevention:** M5's and M7's success criteria both require *running* the generic `applyDeltas`
   interpreter against the actually-mutated `World` with the actually-recorded `steps` and asserting real
   fingerprint equality — the same discipline as decision-engine's replay proof (`decide(record.inputs)
   deep-equals record.outcome`), applied to undo instead of redo, and made easier here precisely because
   `steps` is data that a verifier can re-run independently rather than a closure they have to trust. M8's
   demo also runs it live, so a reviewer can watch it happen rather than read an assertion.
3. **Risk: divergence is detected and logged, but nothing downstream changes** — reconciliation becomes a
   dashboard nobody acts on, which is a story generator with a "checked against reality" sticker on it.
   **Prevention:** M4's success criteria require the trust-gate boolean to provably flip at a threshold — a
   test, not a doc claim — and M6/M7 require at least one domain (#3, notification) to actually be forced
   through the stricter escalation path because of it, in the demo data, not hypothetically.

---

## Notes on the "share infrastructure only" constraint

This plan reuses, as infrastructure (never conceptual core): the genesis-kit milestone-table shape (freeze
boundary / demo command / falsifiable criteria), the M2-early-deploy discipline, the `--webpack` +
`extensionAlias` Next.js config, the `npm ci`-only rule, the grep-based architectural-invariant testing
pattern, and the docs/ARCHITECTURE.md "what does each stage refuse, and why, cited to real tests" shape. It
does not reuse the five-outcome decision model, the reversibility × cost model, the DID/VC identity or claims
model, or any shared npm package — every type in §A.5 is original to this project and the repo runs
standalone from a clean clone.
