# ADR 0002 — The shadow-execution engine: adapter contract, fail-closed validation, and self-consistency

- **Date:** 2026-09-20
- **Status:** accepted
- **Phase / milestone:** M3 (BUILD) — `lib/simulate/`

## Context

`sim-plan.md` §A.1–§A.2 name M3's whole reason for existing: build `simulate(action, world, adapter)`
performing shadow execution — running the same state-transition logic a real write would run, against a
cloned `World`, returning a typed `ProjectedEffect`, never committing, never a sentence — and make the
claim "this isn't just an LLM guessing" *structural*, not asserted. This ADR records the alternatives
considered for the adapter interface, the validation/fail-closed policy, and the self-consistency check,
plus the one deviation from the plan's literal pseudocode that this milestone could not avoid (needing
`applyDeltas`-shaped logic before M5, which owns it, exists).

`lib/contracts/**` is untouched by this milestone — confirmed by `git diff main -- lib/contracts` being
empty at every commit in this branch, not merely at the end.

## Decision 1 — The adapter interface: what the engine gives it, what it must return

**Alternatives considered:**

- **An adapter that receives the live `World` and returns nothing (mutates in place).** Rejected outright:
  this is the exact isolation failure `lib/contracts/world.ts`'s own header already argues against for a
  "live handle" `World` (ADR 0001, Decision 1) — `simulate()` exists specifically so a projection's mutation
  never escapes to the real world; an in-place-mutating adapter interface would make that impossible to
  guarantee by construction.
- **An adapter that receives `(action, world)` and returns `Promise<ProjectedEffect>`.** Rejected: see
  `adapter.ts`'s own header for the full argument. A synchronous return type is a SECOND, independent
  structural barrier against Approach A (`sim-plan.md` §A.2) on top of the grep-based architectural test
  (`__tests__/architecture.test.ts`) — nearly every real way to reach an LLM or a third-party API from Node
  requires `Promise`, so forbidding it at the type level closes an entire class of evasion the grep test
  cannot enumerate ahead of time. Stated honestly: this does not make an async call absolutely impossible
  (a sufficiently determined implementation could bridge to a blocking synchronous call), but it forecloses
  every ordinary path, matching the plan's own "structural, not by promise" standard.
- **Chosen:** `SimulationAdapter<TState>.project: (action: Action, world: World<TState>) => ProjectedEffect`
  — synchronous, and `world` is never the caller's live object (see Decision 2). `Action` had to be defined
  in this milestone's own files (`action.ts`) because `lib/contracts/**` never defined it — confirmed by
  grep before writing anything (the only hit anywhere in the repo was a comment in `rollback.ts` recounting
  decision-engine's `Prohibition.matches` history, not a real export) — and `sim-plan.md` §A.1 is explicit
  that scoring an action's cost/reversibility is not this project's job, so `Action` here is kept to the
  bare minimum `simulate()` needs (`domain`, `type`, `params: Json`), not a richer model duplicating
  decision-engine's own `Action` contract.

## Decision 2 — Non-mutation: reusing `deepFreezeClone`, and why `simulate()` still builds its own `safeWorld`

ADR 0001 left a forward note for this exact milestone: `deepFreezeClone` (`lib/contracts/world.ts`) already
exists and does the deep-clone-then-freeze walk `simulate()` needs; M3 should call it, not write a second
one. **It fits, and `simulate.ts` calls it directly** — for both `world.data` and `action.params` (the
latter for the identical reason: `Action.params` is `Json`-constrained the same way `World.data` is, and an
adapter that could mutate its own input parameters in place would be exactly as unsafe, one call argument
over).

**What required a real decision, not just reuse:** whether `simulate()` may assume its input `World` is
already frozen (because it was built via `makeWorld`, which already deep-freezes `data`) or must defend
itself regardless.

- **Alternative considered:** trust that every caller uses `makeWorld`, and skip any defensive freezing
  inside `simulate()` itself. Rejected: this is exactly the "a guarantee that only holds if every caller
  remembers to do the right thing" failure `world.ts`'s own header rejects for `World.data`'s plainness
  (Decision 1, ADR 0001) — a `World` can still be built by hand (deliberately exercised in
  `lib/contracts/__tests__/`, and again in `__tests__/immutability.test.ts` here, on purpose), and a
  `simulate()` that only worked correctly against `makeWorld`-constructed input would be a guarantee that
  holds by convention, not by construction.
- **Chosen:** `simulate()` builds a fresh `safeWorld = { ...world, data: deepFreezeClone(world.data) }`
  before ever calling the adapter — a clone nobody outside `simulate()` has ever held a reference to,
  regardless of whether the caller's own `world.data` was already frozen. This is deliberately NOT
  "freeze the caller's object in place instead of cloning": `world.ts`'s own header already argues that a
  constructor freezing a caller's object out from under them is not this layer's call to make, and
  `deepFreezeClone`'s clone-then-freeze design already embodies that — reusing it as intended means this
  milestone inherits that same argument rather than re-deciding it.
  `__tests__/immutability.test.ts`'s "CLAIM 2" test proves this holds even for a hand-built `World` that
  was never frozen by its caller at all.

## Decision 3 — What happens when an adapter throws, returns a malformed effect, or lies about its own math — and what "fail closed" means here

This is the build brief's most pointed question: *"a simulator that trusts its adapter is a story
generator."* Three sub-decisions, each with a rejected alternative:

**3a — Adapter throws.** Alternative considered: let the exception propagate out of `simulate()` raw.
Rejected: a caller (M4's reconciler, M6's domain wiring, or this milestone's own test suite) would need a
`try/catch` around every single `simulate()` call, and a thrown value carries no structured information
about WHICH of `simulate()`'s several possible failure modes actually happened. **Chosen:** caught and
turned into a named `SimulationFailure` (`{ kind: "adapter-threw"; error: string }`) — `result.ts`'s own
header explains why `error` is a plain string here without reopening `ProjectedEffect.assumptions`'s
closed-vocabulary discipline (this channel is the engine's own diagnostic about a malfunction, never a
claim a projection makes about the world).

**3b — Malformed effect.** Alternative considered: trust the TypeScript return type
(`SimulationAdapter.project` is typed to return `ProjectedEffect`, so why check?). Rejected: a compile-time
type is a discipline on code this repository controls; it says nothing about a value produced by a
`project()` implementation this milestone did not write (a future M6 domain, a hostile test fixture, a value
smuggled past the checker with `as ProjectedEffect`) — the same class of gap `world.ts`'s `isPlainData`
already closes for `World.data`, one layer over. **Chosen:** `effect-validation.ts` walks the raw, `unknown`
value by hand — every field, every closed-vocabulary member (`AssumptionKind`, `Delta.kind`, the
`producedBy` literal) — and reports every problem found, not just the first.
`__tests__/consistency.test.ts` proves this catches a free-text assumption smuggled past the type system at
runtime, the literal "model's prose" shape `projected-effect.ts` exists to reject at compile time.

**3c — Deltas that contradict the claimed `resultingFingerprint`.** See Decision 4 below — this is the
strongest of the three checks and gets its own section.

**What "fail closed" means, precisely:** `SimulationResult` (`result.ts`) is a discriminated union; every
failure variant is a *named reason*, and **no failure variant also carries a usable-looking `effect`
alongside it**. A caller can only reach a real `ProjectedEffect` through the `ok: true` branch. This was a
deliberate choice against a shape like `{ ok: boolean; effect?: ProjectedEffect; problems: string[] }`,
which would let a careless caller reach past `problems` and use `effect` anyway "because it's probably
fine." Fail-closed here means closed to a caller PROCEEDING on anything unverified — not closed as in
silent; every failure names exactly what went wrong.

## Decision 4 — Self-consistency: can the engine verify a projection against itself, and does it?

**Yes — this is `consistency.ts`, the single strongest answer this milestone has to "you're just asking a
model to guess."** Two layers, not one:

1. **Per-delta `before` consistency** — before applying delta *i*, its claimed `before` is checked against
   what is actually at `delta.path` in the world after deltas `0..i-1` have been applied. Alternative
   considered: skip this and only check the final hash. Rejected: a final-fingerprint-only check can be
   fooled by a `deltas` array whose *individual* entries lie about the starting state while still landing
   on a plausible-looking final hash for some unrelated reason — `__tests__/consistency.test.ts`'s "lying
   about the starting value" test constructs exactly this case (a delta internally self-consistent about
   `before: 39` when the real `World` actually started at `7`) and confirms Layer 1 catches what a
   Layer-2-only check would miss.
2. **Final fingerprint consistency** — after applying every claimed delta, `computeFingerprint` of the
   result must equal the effect's own claimed `resultingFingerprint`. This is the literal check the build
   brief describes.

**What this does NOT and cannot prove, stated as plainly as `consistency.ts`'s own header states it:**
self-consistency is necessary, not sufficient. An adapter's `project()` can be internally consistent (its
deltas really do produce its own claimed hash, from the real input `World`) and still be *wrong* about what
the real execution will do — a calendar-reschedule adapter that hand-mirrors the wrong business rule,
consistently, passes every check in this file. Closing THAT gap is M4's job (reconciliation: predicted vs.
OBSERVED, from a real post-execution `World`) — nothing computed before the real write runs can prove a
projection matches reality, only that it doesn't contradict itself.

**The honest duplication-risk this check costs, named rather than hidden:** proving self-consistency
requires *some* forward-delta-application logic, and `sim-plan.md` §A.4 assigns "the one generic
`applyDeltas` interpreter" to `lib/rollback/**` (M5), a later freeze boundary that does not exist yet. Two
paths were available: (a) skip the self-consistency check until M5 lands, or (b) write the narrow slice this
milestone actually needs — `path.ts`'s `getAtPath`/`setAtPath`/`deleteAtPath`, scoped to *reading and
writing one `Json` leaf*, nothing about `World` metadata, versioning, or rollback semantics — and name the
overlap plainly. **(b) was chosen.** `path.ts`'s own header records a forward note for M5 explaining the
overlap and inviting M5 to import or supersede these primitives once it exists, and these functions are
deliberately NOT exported from `lib/simulate`'s public barrel (`index.ts`) so they remain free for M5 to
replace without that being a breaking change to anything outside this directory.

## Decision 5 — Does §A.2's Approach-B-folded-in affect this milestone's interface?

**No — it is purely an M6 implementation detail, and the interface already accommodates it without change.**
`sim-plan.md`'s Approach C ("chosen, with B folded in as an implementation strategy where a transactional
substrate genuinely exists") means a domain's `project()` MAY internally start a real transaction, apply the
real write, read the delta, and roll back — but from `simulate()`'s point of view, every `project()` still
looks identical: a synchronous function taking `(action, world)` and returning a `ProjectedEffect`. Whether
the domain computed that return value by hand-mirroring logic or by a discarded real transaction is
invisible on the other side of this one call boundary, and correctly so — the interface was never going to
need a "how did you compute this" field, because `producedBy: "shadow-execution"` already covers the one
provenance this whole architecture guarantees regardless of internal strategy (ADR 0001, Decision 3).

**One real, stated tension this DOES surface, as a forward note for M6 rather than something resolved here:**
Decision 1 above requires `project()` to be synchronous. A domain wanting to use Approach B against a real,
async-only transactional store (a genuine SQL driver, for instance) cannot comply with that constraint
without wrapping its transaction in something synchronous — realistic for this project's own domains, since
`sim-plan.md` §0.4 already commits every demo domain to being "self-contained, in-memory, and synthetic,"
but a real limitation for any future domain that isn't. Recorded here for M6 to inherit, not rediscovered
independently.

## Decision 6 — Purity: detected, not structurally prevented — said so, not claimed otherwise

The build brief asks directly whether the engine can *structurally* prevent an impure adapter or only
*detect* one, and warns against claiming more than is true. **The honest answer: only detected.**
`simulate()`'s own body is provably deterministic (no `Date.now()`, no `Math.random()`, no output built by
iterating a `Set`/`Map` in an order this engine itself introduces — `effect-validation.ts` and
`consistency.ts` both iterate the ADAPTER's own arrays in the order the adapter supplied them). But nothing
in `SimulationAdapter.project`'s type signature — or in any runtime check this milestone could write —
stops the function's BODY from reading the clock or a random source; no test can prove a universal negative
over arbitrary future domain code, the same limit `world.ts`'s "known, unclosed gap" paragraph already
states honestly for a hostile `Proxy` defeating `isPlainData`, one layer over.

`__tests__/purity.test.ts` proves both halves rather than only the flattering one: the positive case (a
real deterministic fixture adapter, called three times with identical input, produces deep-equal output
every time) AND a deliberately-impure fixture adapter (`Math.random()` inside `project()`) whose repeat
calls do **not** agree — demonstrating the gap honestly rather than asserting it doesn't exist.

## Consequences

- Positive: `SimulationResult`'s fail-closed shape means no downstream code (M4's reconciler, M6's domain
  wiring) can accidentally execute a real write against an effect this engine could not itself verify —
  there is no code path that hands back a usable effect under any failure variant.
- Positive: `consistency.ts`'s two-layer check is a real, cheap, structural answer to "it's just guessing" —
  stronger than the plan's own literal ask (which named only the final-hash check), while stating plainly
  what it does not prove.
- Negative / cost: `path.ts` narrowly duplicates a sliver of what M5's `lib/rollback` `applyDeltas` will
  own. Accepted and recorded as a forward note (Decision 4) rather than hidden, because deferring the
  self-consistency check until M5 exists would have thrown away a cheap, strong guarantee this milestone
  could honestly build now.
- Negative / cost: requiring `project()` to be synchronous (Decision 1) forecloses a genuine, real-store
  Approach-B implementation over an async-only transactional substrate. Accepted for this plan's own demo
  domains (all synthetic and in-memory per §0.4) and recorded as a forward note for M6 if that ever stops
  being true.
- Negative / cost, stated honestly: purity is DETECTED, not structurally GUARANTEED, for an adapter's own
  internal behavior. This is the one success criterion this milestone can only partially deliver on by
  construction, and `simulate.ts`'s header, `adapter.ts`'s header, and `__tests__/purity.test.ts` all say so
  in the same words rather than three different, slightly-differently-hedged claims.

## Alternatives rejected (summary, cross-referenced above)

- An adapter that mutates the live `World` in place (Decision 1) — the exact isolation failure `World`'s
  snapshot design (ADR 0001) exists to prevent.
- An async (`Promise`-returning) `project()` (Decision 1) — would reopen, at the type level, the exact
  network/LLM-call path the grep-based architectural test exists to close at the import level.
- Trusting every caller to construct `World` via `makeWorld` and skipping defensive freezing inside
  `simulate()` (Decision 2) — a guarantee that holds by convention, not by construction.
- Trusting `project()`'s declared TypeScript return type instead of validating the runtime value
  (Decision 3b) — the same gap `isPlainData` already closes for `World.data`, left open one layer over.
- A `SimulationResult` shape that carries both a failure AND a possibly-unverified `effect` "for reference"
  (Decision 3) — invites a caller to bypass the fail-closed discriminant.
- Checking only the final `resultingFingerprint` and skipping the per-delta `before` check (Decision 4) —
  misses a real class of lie a final-hash-only check cannot see.
- Deferring the self-consistency check entirely until M5's `applyDeltas` exists (Decision 4) — gives up a
  cheap, strong, available-now guarantee to avoid a small, named, forward-noted duplication.

<!-- Copy this file to NNNN-<slug>.md for each irreversible decision.
     Then add a one-line pointer in wiki/index.md if it becomes something later milestones need to find. -->
