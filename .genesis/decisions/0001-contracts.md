# ADR 0001 — The four contracts: alternatives considered, and why Rollback carries data, not a closure

- **Date:** 2026-09-20
- **Status:** accepted
- **Phase / milestone:** M1 (BUILD) — `lib/contracts/`

## Context

`sim-plan.md` names four irreducible types (§A.5) that every later milestone must import and none may
redefine: `World<TState>`, `ProjectedEffect`, `Reconciliation`, `Rollback`, plus a supporting
`AssumptionKind` enum and `SimulatorTrust` shape. M1's job is to fix these shapes exactly once, correctly,
because `lib/contracts/**` freezes at the end of this milestone — a mistake here is a mistake every one of
the other eight milestones inherits. This ADR records the alternatives considered for each type and why the
chosen shape won, plus one significant course-correction the plan itself made before any code existed.

## Decision 1 — WORLD: a hashed snapshot, not a live handle or a full event log

**Alternatives considered:**

- **A live handle/reference to the real resource** (e.g. `World` wraps a database connection or an object
  reference into live state). Rejected: `simulate()` (M3) must run against a *cloned* copy whose mutation
  never escapes to the real world (plan §A.1) — a live handle makes that isolation impossible to guarantee
  structurally; a domain author would have to remember to clone before every `project()` call, and a
  forgotten clone would silently corrupt real state during a simulation. A `World` that already IS a
  detached, hashed snapshot makes the unsafe path (mutating the original) simply not exist.
- **A full event log / operation history instead of a point-in-time snapshot.** Rejected for this
  milestone: reconciliation (M4) only ever needs to compare two snapshots' worth of `Delta`s (a before and
  an after), not replay an arbitrary history. An event log is strictly more general and strictly more
  machinery than any of the plan's four domains (§D) need; it can be added later without touching
  `World`'s own shape (an event log would be built FROM a sequence of `World` snapshots, not instead of
  them).
- **Chosen: a typed, addressable, versioned, hashed snapshot** — `id`, `domain`, `version`, `at`, `data`,
  `fingerprint`. `version` and `fingerprint` are both present, deliberately not redundant: `version` is a
  cheap, monotonic integer for detecting "has anyone touched this since I read it" without hashing anything;
  `fingerprint` is the actual content hash used for real equality checks (did rollback actually restore the
  exact prior state). A verifier who only had one of the two would either need to hash on every staleness
  check (wasteful) or would have no way to prove restoration by content rather than by "the version number
  matches" (which says nothing about the actual data).

**`World.data` must be plain, serializable data — no functions, enforced two ways.** This is M1's most
explicit success criterion, so it gets its own sub-decision. `TState` is constrained to a recursive `Json`
union (primitives, plain arrays, plain objects) at the type level — a `World<{ onCancel: () => void }>`
does not compile (`__tests__/world.test.ts` proves it). But TypeScript's structural typing cannot stop a
deliberate cast around that constraint, the same gap decision-engine's own `__tests__/brand-casts.test.ts`
documents for its branded `Confidence`/`CostOfBeingWrong` types. So `isPlainData`/`assertPlainData`
(`world.ts`) walk an actual value at runtime and reject a function, a symbol-keyed property, a
`Date`/`Map`/`Set`, or a circular reference — everything `JSON.stringify` would either silently drop or
throw on, and everything that would make `fingerprint`'s hash depend on identity rather than content.
**Rejected alternative:** rely on `computeFingerprint` (fingerprint.ts) to throw when it meets something
unhashable, and call that "enforcement." That pushes the guarantee from "cannot construct a bad World" to
"a bad World is only caught the first time something hashes it" — a `World` built for display only, never
hashed, would never trip that check at all. Failing at construction (`assertPlainData`) is strictly earlier
and strictly more honest about where the guarantee actually lives.

## Decision 2 — WHERE DOES A PROJECTION COME FROM (carried in from §A.2 — the make-or-break question)

Three approaches were considered for the mechanism `ProjectedEffect` values must be producible by, even
though M1 itself builds no `simulate()` — the shape of `ProjectedEffect` (specifically, `producedBy` and
`assumptions`) is a direct consequence of this choice, so it belongs in this ADR, not deferred to M3's own
document.

- **Approach A — ask an LLM to narrate the likely outcome.** Rejected outright: this is the disqualified
  "prompt wrapper with no system behind it." A model's guess is not a typed value, cannot be diffed against
  reality by machine, and its failure mode (a plausible-sounding wrong answer) is invisible until a human
  reads it. This is the alternative `ProjectedEffect`'s own shape exists to make structurally unreachable —
  see Decision 3 below.
- **Approach B — real transactional replay** (start a transaction, apply the real write, inspect the delta,
  roll back before returning). Strengths: perfectly accurate by construction. Weaknesses: only exists for
  actions with a true transactional substrate; the domains that make this project interesting (sending a
  notification, calling a third-party API) have no such substrate, so an approach built only on B would
  collapse back to "predict, don't execute" for exactly the hardest cases.
- **Chosen: Approach C — a domain-supplied pure shadow-execution function**, `project(action, world):
  ProjectedEffect`, with B folded in as an *implementation strategy* where a transactional substrate
  genuinely exists. The outward contract (a typed `ProjectedEffect`, full stop) never changes regardless of
  which strategy a domain uses internally. This is why `ProjectedEffect.producedBy` is a single-value
  literal type (`"shadow-execution"`) rather than a field distinguishing "real transaction" from "hand-
  mirrored logic" — from the contract's point of view, both are equally valid instances of the one thing
  this project claims to produce, and the plan's own falsifiability story (M3's grep-based zero-LLM-import
  test) is what makes the claim checkable, not a field on the value itself.

## Decision 3 — PROJECTED EFFECT: a typed diff, and why `producedBy` and `assumptions` are both closed, not open

`ProjectedEffect` is `{ deltas, resultingFingerprint, assumptions, producedBy }`. Two fields on this type
are the ones most tempted to widen to a bare `string`, and both were deliberately kept closed:

- **`producedBy: "shadow-execution"`** — a literal type with exactly one valid value, not `producedBy:
  string`. **Alternative considered:** a `provenance` field with several string values ("shadow-execution",
  "llm-estimate", "manual-override") for "future flexibility." Rejected: per Decision 2, this project has
  exactly one approach it claims to use, structurally enforced by M3's freeze boundary; a field that could
  hold `"llm-estimate"` would be inviting the exact provenance this whole architecture exists to rule out,
  one string literal away from being written by someone who didn't read this ADR. A single-member literal
  type costs nothing today and closes that door by construction.
- **`assumptions: ReadonlyArray<AssumptionKind>`**, `AssumptionKind` a closed three-member union
  (`"no-concurrent-writer" | "world-version-unchanged" | "clock-monotonic"`), never `assumptions:
  string[]`. **Alternative considered:** free-text assumptions, e.g. `"assume the customer doesn't cancel
  in the next 5 minutes"` — flexible, and exactly the crack the plan's §A.1 warns about: "every field in the
  type, including `assumptions`, is a value a model's prose cannot occupy without a type error." Mirrors
  decision-engine's own `ValueConstraint` operator-set discipline (ADR 0004: "operator set chosen
  deliberately, kept deliberately small" — four operators, argued against three real domains, with a
  documented list of what was deliberately left out and why). This project follows that precedent rather
  than starting `assumptions: string[]` and hoping discipline holds: the three members named are exactly
  the preconditions a shadow execution needs in order for its prediction to still hold once the real write
  runs, and a fourth, real assumption would need to be added to this file — a reviewable, greppable change
  — rather than typed freely at each call site.
- **`deltas: ReadonlyArray<Delta>`**, never a string description. This is the field the plan's §A.1 states
  most directly: "a typed array of field-level deltas and a predicted resulting hash, never a sentence."

**Not parametrized by `TState`** (a deviation from the plan's own §A.5 sketch, which writes
`ProjectedEffect<TState>`): verified during implementation that none of this type's fields actually depend
on the state's shape (`Delta.before`/`after` are already `unknown`; `resultingFingerprint` is a `string`
regardless of what it hashes), and this project's tsconfig (`noUnusedLocals`, matching decision-engine's own
strictness) makes an unused type parameter an actual compile error (`TS6196`), not a style nit — confirmed
directly against this repo's own `tsc` before writing this ADR, not assumed. `Rollback` inherits the same
deviation for the same reason (its only use of `TState` was inside `ProjectedEffect<TState>`).

## Decision 4 — RECONCILIATION: a discriminated union, exhaustively matched, not a boolean or a severity score

**Alternatives considered:**

- **A single boolean (`matched: boolean`).** Rejected: collapses `drifted` (a named field disagreed) and
  `unprojected` (something happened that was never predicted) into the same "false," which are genuinely
  different failure shapes needing different downstream handling (a drift names an `expected`/`actual` pair
  to show a judge; an unprojected change has no `expected` to name at all).
- **A severity number (0–100).** Rejected for the same reason ADR 0001's own `decide()` rejected a single
  risk score for the five-outcome model, one layer over: a scalar cannot distinguish *why* something didn't
  match, only *how much*, and this plan's §E.3 risk ("divergence is detected and logged, but nothing
  downstream changes") is exactly the failure mode a severity score with no required response invites.
- **Chosen: a three-member discriminated union on `status`** (`confirmed` / `drifted` / `unprojected`),
  each carrying exactly the data needed to explain itself (`matched` deltas; an `expected`/`actual` pair; a
  lone `actual`) — never a bare label. Paired with `assertNeverReconciliation`, the same exhaustiveness-proof
  pattern decision-engine's `assertNeverOutcome` uses for its five-outcome union: a `switch` that ends its
  `default` branch with `assertNeverReconciliation(reconciliation)` fails to compile the moment a fourth
  status is added and that switch isn't updated — proven in `__tests__/reconciliation.test.ts` via a
  literal four-status stand-in type (the real `Reconciliation` stays frozen at three for this milestone; the
  test cannot honestly widen the frozen type just to demonstrate the mechanism, so it demonstrates the
  mechanism on an equivalent hypothetical union instead).

## Decision 5 — ROLLBACK: the central correction — data, not a closure, and why this is not a style preference

This is the most significant course-correction in the plan, and it happened before any code was written
(plan §A.4), which is exactly when a mistake like this is cheapest to catch.

**The rejected shape.** An earlier draft of this plan typed the runnable case as:

```ts
{ kind: "runnable"; compensate: (world: World<TState>) => World<TState>; ... }
```

**Why this is the exact mistake decision-engine's own history already made and reversed, one layer down —
not merely an analogous one:**

1. `Prohibition.matches` (`decision-engine/lib/decide/prohibition.ts`) started as `(action: Action) =>
   boolean` — a predicate closure. It could not be serialized. `.genesis/decisions/0003-audit-model.md`
   (Decision 3, "PROHIBITIONS") records the forced consequence: the audit trail could only record
   prohibitions **by id**, and `replay()` had to require the caller to supply the real predicate set again
   at replay time (`replay(record, prohibitions)`), an honest but real limitation stated plainly in that
   ADR: "a record is only replayable relative to a known set of rules ... it proves which rule fired, never
   what the full rule set *was* at decide-time, beyond the ids it names."
2. ADR 0004 ("Value constraints") then hit the identical choice for `ValueConstraint` and, having already
   paid for the closure mistake once, refused to repeat it: a `valueCheck?: (v: unknown) => boolean`
   predicate closure was "considered and rejected outright: it would reproduce the exact wart
   `Prohibition.matches` ... already has." `ValueConstraint` was built as a small, closed, data-only
   discriminated union (`equals`/`lte`/`gte`/`in` plus a threshold) instead, evaluated by one small,
   engine-owned, total function — never a domain-supplied predicate.

`Rollback.runnable` repeats ADR 0004's fix rather than ADR 0003's original mistake — and the stakes are
strictly higher here than for either sibling case. `Prohibition` and `ValueConstraint` are *policy* — they
decide whether something is ALLOWED. `Rollback` is a claim about something that already HAPPENED: "I undid
this write." That is precisely the kind of claim an independent verifier most needs to be able to replay
and check, not merely trust — and a closure defeats every part of that:

- **Cannot be recorded into an audit-style trail.** A function value has no serializable representation to
  write next to the `World` it was claimed to restore.
- **Cannot be replayed by an independent verifier.** There is no way to "run this claim again" from a
  recorded artifact if the artifact never captured what would actually run.
- **Cannot be compared for equality.** Two rollbacks either did the same thing or they didn't; a closure can
  only be compared by `Function.prototype.toString()`-scraping its source text, which is not an equality
  check anyone should have to trust, and which two semantically identical but differently-written closures
  would fail anyway.

**The fix, chosen:** `steps: ReadonlyArray<Delta>` — the SAME `Delta` type `ProjectedEffect.deltas` already
uses, inverted (`observedEffect.deltas.map(invertDelta)`, M5's job, computed once by one small, engine-owned
`invertDelta` function — never a domain-supplied closure — and then recorded verbatim). Executing a rollback
becomes `applyDeltas(mutatedWorld, rollback.steps)`, the exact same generic interpreter M3/M4 use to apply
deltas forward. This buys back everything the closure gave up: `steps` sits next to the `World` it applied
to in a record, a verifier can literally re-run `applyDeltas(recordedPreWorld, recordedSteps)` and diff the
result against what was claimed, and two rollbacks compare with plain deep-equality, not source-text
scraping.

`unavailable.blastRadius` follows the same discipline in the other direction: a domain with no true inverse
(the outbound-notification domain, plan §D.3 — there is no `Delta` whose inversion means "the recipient
never read the email") must declare `unavailable` with a named `reason` AND a `blastRadius`, both data,
never a fabricated `steps` array that would apply cleanly against `World.data` while lying about what
happened in the real world. Both variants of `Rollback` are therefore proven, not asserted, by
`__tests__/rollback.test.ts`'s `@ts-expect-error` cases: a `runnable` literal missing `steps`, and an
`unavailable` literal missing `reason`, both fail to compile.

## Consequences

- Positive: every claim `Rollback` makes is independently replayable from data alone — the same property
  ADR 0003/0004 fought to establish for decision-engine's audit trail, available here from M1 onward instead
  of retrofitted after an independent verifier found the gap.
- Positive: `ProjectedEffect`'s two closed-vocabulary fields (`producedBy`, `assumptions`) make "this project
  is secretly asking a model to guess" a claim that is false by construction for any value that actually
  typechecks, not merely a claim this document makes about the code.
- Negative / cost: a domain whose real compensating operation genuinely doesn't fit the four `Delta.kind`
  values (`set`/`increment`/`remove`/`append` — `delta.ts`) has no escape hatch to express it as `steps`; it
  must honestly declare `unavailable` instead. This is treated as acceptable, not merely tolerated: a
  `Delta` vocabulary open-ended enough to express arbitrary compensations would be the same "expression
  language nobody asked for" ADR 0004 already rejected for `ValueConstraint`'s operators, one layer over.
- Negative / cost: `ProjectedEffect`/`Rollback` losing their `TState` parameter (Decision 3) means a future
  milestone that needs a state-shaped field on either type (e.g. a typed preview of the resulting
  `World.data`) must reintroduce the parameter then, touching a frozen file — an explicit, deferred cost
  accepted now rather than carrying an unused parameter (and the compile error it causes) through eight
  milestones on the chance it's needed later.
- Forward note for M5, recorded now rather than rediscovered then: `computeFingerprint` (fingerprint.ts) is a
  32-bit FNV-1a — a change detector, not a signature, and its own file header already says so plainly; this
  is not being revisited or widened here. What changes at M5 is the STAKES, not the hash: M5's rollback
  engine (plan §A.4) makes `fingerprint` equality the actual proof mechanism for "did rollback really restore
  the exact prior state," not merely a cheap drift check. A 32-bit hash's birthday bound is real at that
  point, not theoretical — collisions become roughly as likely as not once around 2^16 · sqrt(π/2) ≈ 77,000
  distinct values have been hashed and compared against each other, well within reach of a long-running or
  heavily-exercised demo. M5 should either (a) state explicitly the sample-count ceiling under which it is
  relying on 32-bit hash equality as proof, and accept the risk above that ceiling by name, or (b) widen
  `computeFingerprint`'s output at that point, when the claim built on top of it actually needs the stronger
  guarantee. This is deliberately not M1's decision to make — `fingerprint.ts` stays exactly as it is for this
  milestone — but M5 should inherit this question from this ADR, not rediscover it independently the way an
  L4 verifier would otherwise have to point it out twice.

## Alternatives rejected (summary, cross-referenced above)

- LLM-narrated projections (Decision 2, Approach A) — disqualified "prompt wrapper," no typed value to diff.
- Real-transaction-only projections (Decision 2, Approach B) — collapses for every domain with no
  transactional substrate, which is most of what makes this project interesting.
- A live handle instead of a `World` snapshot (Decision 1) — cannot structurally guarantee simulation
  isolation.
- A full event log instead of a point-in-time `World` snapshot (Decision 1) — more machinery than any of
  the plan's four domains need at this stage.
- `producedBy: string` / an open provenance field (Decision 3) — reopens exactly the door Decision 2 closes.
- `assumptions: string[]` (Decision 3) — the literal "model's prose" failure mode the plan names directly.
- `Reconciliation` as a boolean or severity score (Decision 4) — cannot distinguish `drifted` from
  `unprojected`, or explain itself without a downstream lookup.
- `Rollback.runnable.compensate` as a closure (Decision 5) — the plan's own documented, reversed mistake;
  unserializable, unreplayable, uncomparable.

<!-- Copy this file to NNNN-<slug>.md for each irreversible decision.
     Then add a one-line pointer in wiki/index.md if it becomes something later milestones need to find. -->
