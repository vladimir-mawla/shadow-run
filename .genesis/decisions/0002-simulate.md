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
  cannot enumerate ahead of time. **Stated honestly, and tightened after independent verification:** the
  gap here is not merely "a sufficiently determined implementation could bridge to a blocking synchronous
  call" — it is an ORDINARY one, confirmed working end to end: ESM top-level `await`, run once at module
  initialization, prefetches a real network/LLM response before `project()` is ever called, so `project()`
  itself is genuinely synchronous by every measure this milestone can check, and `simulate()` accepts it
  cleanly (`ok: true`, returning the prefetched value). The grep-based architectural test cannot help here
  even in principle, for a reason worth stating precisely: that test's frozen boundary is `lib/simulate/**`;
  a real domain adapter's own module lives in `domains/**` (M6's directory), so there is no file inside this
  milestone's scan for the grep test to have read in the first place. This is a real, named, unresolved gap
  for M6 to inherit — not something this milestone's synchronous-signature choice actually closes, even
  though it still closes every path that requires an in-`project()` `await`.
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

## Decision 6 — Purity: detected, not structurally prevented — said so, not claimed otherwise, and scoped to what is actually checked

The build brief asks directly whether the engine can *structurally* prevent an impure adapter or only
*detect* one, and warns against claiming more than is true. **The honest answer: only detected — and even
"detected" is narrower than the first draft of this ADR and its accompanying comments stated,** tightened
after independent verification named the gap precisely rather than leaving it as an abstract disclaimer.
`simulate()`'s own body is provably deterministic (no `Date.now()`, no `Math.random()`, no output built by
iterating a `Set`/`Map` in an order this engine itself introduces — `effect-validation.ts` and
`consistency.ts` both iterate the ADAPTER's own arrays in the order the adapter supplied them). But nothing
in `SimulationAdapter.project`'s type signature — or in any runtime check this milestone could write —
stops the function's BODY from reading the clock or a random source; no test can prove a universal negative
over arbitrary future domain code, the same limit `world.ts`'s "known, unclosed gap" paragraph already
states honestly for a hostile `Proxy` defeating `isPlainData`, one layer over.

**The precise, narrower claim, with the concrete gaps named rather than left abstract** (see `simulate.ts`'s
own header for the same three points in situ): what is actually detected is impurity that MANIFESTS IN THE
RETURNED `ProjectedEffect` BETWEEN TWO CALLS WITH IDENTICAL INPUT. Confirmed by independent verification to
NOT cover, specifically:

1. An adapter that reads `Date.now()`/`Math.random()` on every call but never lets the result reach the
   returned `deltas`/`resultingFingerprint` — the side effect is real; a check that only ever compares
   OUTPUTS cannot see it.
2. An adapter impure only from its Nth call onward (an internal counter, a cache that fills after a few
   calls) — a test that calls it two or three times cannot see impurity that needs more repetitions than
   that.
3. An adapter impure only for an input this milestone's tests never happened to exercise.

`__tests__/purity.test.ts` proves both halves rather than only the flattering one: the positive case (a
real deterministic fixture adapter, called three times with identical input, produces deep-equal output
every time) AND a deliberately-impure fixture adapter (`Math.random()` inside `project()`, whose result DOES
reach the returned effect) whose repeat calls do **not** agree — demonstrating the ONE shape of impurity
this milestone can actually detect, not impurity in general.

## Decision 7 — Does `Delta.kind` get checked against its own `before`/`after`?

Added after independent verification confirmed both `{ kind: "increment", before: 39, after: "banana" }`
and `{ kind: "increment", before: 39, after: 10 }` (a decrease labeled an increment) passed
`effect-validation.ts` cleanly. `delta.ts`'s own header calls `increment`, by name, "a signed numeric
change to a counter" — a declared meaning this file was silently not checking at all.

**Alternatives considered:**

- **Check nothing** (the original state). Rejected on reflection: `kind`'s declared meaning is part of
  `Delta`'s own contract (`lib/contracts/delta.ts`), not an invented rule — a shape check that validates
  `kind` is one of the four closed strings but never asks whether the REST of the object is coherent with
  the one it picked is checking less than its own stated job ("this file checks SHAPE").
- **Enforce numeric type AND non-negative direction** (reject a decrease under `"increment"`). Rejected:
  `delta.ts` says "signed" — a decrement expressed as `kind: "increment"` with `after < before` is exactly
  what "signed" means, and rejecting it would invent a constraint the type never states, over-constraining
  in the opposite direction from the original gap.
- **Extend the same numeric check to `set`/`remove`/`append`.** Rejected: `delta.ts` makes no numeric claim
  for any of the other three kinds — `set` legitimately replaces a scalar with a wholesale different shape
  (object, string, boolean), and `remove`/`append` carry whatever the domain's real data holds. Extending a
  numeric constraint to them would be validating a rule `Delta`'s own type never asserts.
- **Chosen:** enforce exactly one, narrow rule — for `kind === "increment"`, both `before` and `after` must
  be finite numbers. Nothing about sign or direction. This is the smallest check that makes the shape
  validator's behavior match `Delta`'s own declared contract for the one kind that makes a numeric claim,
  and no more.

## Decision 8 — The import-containment check (Decision, HIGH-2 finding) had a second gap: symlinks

`__tests__/architecture.test.ts`'s `resolvesInsideAllowedRoots` (added to fix the first HIGH-2 finding —
see the "Alternatives rejected" summary below) checked whether a specifier's TEXTUALLY resolved path landed
inside `lib/simulate/`/`lib/contracts/`. A second round of independent verification confirmed a real,
working exploit one layer deeper: a REAL symlink placed inside `lib/simulate/`, pointing at an arbitrary
directory outside the repository, made the check return `true`. `resolve()` is pure string arithmetic and
never dereferences a symlink, so the computed path's TEXT still started with `SIMULATE_ROOT + sep` — but
Node's real module resolution DOES follow symlinks, so this would actually load external code at runtime.
Git tracks symlinks as ordinary repository objects, so one can land in a future commit exactly like any
other file; this is not a contrived, machine-only concern.

**Alternatives considered for the fix:**

- **Replace the textual check with a realpath-only check.** Rejected: a resolved path that escapes
  TEXTUALLY (the original HIGH-2 case, `../../node_modules/...`, no symlink involved at all) is a different
  failure with a different cause; collapsing both checks into one loses the ability to say WHICH kind of
  escape happened, and — the more important reason — this repo's own drift-guard history (bypassed five
  times) is a standing argument that one clever combined check is less robust than two independent checks
  that each fail on their own terms. **Chosen: keep the textual check AND add the realpath check**, run in
  that order, both required to pass.
- **`realpathSync` the resolved leaf path only, with no fallback.** Rejected: every real, legitimate
  specifier in this codebase's own source ends in `.js` while pointing at a same-named `.ts` file (this
  repo's NodeNext convention — `next.config.ts`'s own `extensionAlias` comment documents the identical
  mapping), so the literal resolved path routinely does not exist under that exact name and `realpathSync`
  would throw for every ordinary, legitimate import in this milestone's own source — not just for an
  attack. **Chosen:** if the exact leaf does not resolve, fall back to realpath-ing its ENCLOSING DIRECTORY
  instead. This is safe, not a loophole: a name that does not exist at all cannot itself be a symlink
  escaping anywhere, so the only thing left to distrust once the leaf is confirmed absent is the directory
  it would live in — which a genuine import needs to actually exist regardless of the leaf's exact
  extension. If NEITHER the leaf nor its directory resolves to anything real, the specifier is REJECTED —
  fail closed, per the build brief's own instruction, never waved through just because this check could not
  pin down where it actually goes.
- **Compare the realpath'd candidate against the UN-realpath'd `ALLOWED_ROOTS`.** Rejected: if the
  repository itself sits under a symlinked path (common on macOS, where `/tmp` is itself a symlink to
  `/private/tmp`), a correctly-contained, legitimate file's realpath would not textually match an
  un-normalized root, producing a FALSE REJECTION that looks like a working guard while actually being
  simply wrong. **Chosen:** realpath the allowed roots too, once, at module load
  (`REAL_ALLOWED_ROOTS`) — both sides of every real-path comparison go through the identical
  normalization.

**Proof, not just argument:** a real symlink (`fs.symlinkSync`, not a synthetic string) is created for the
duration of exactly one test, pointed at a real temporary directory outside the repository, exercised
against `resolvesInsideAllowedRoots`, and torn down in a `finally` block — nothing is left on disk or in
git afterward. A second test confirms the fallback does NOT regress the legitimate `.js`-specifier-to-`.ts`-
file convention this milestone's own source relies on everywhere (`existsSync` confirms the literal `.js`
name is genuinely absent and the real `.ts` file is what's actually on disk, then confirms the specifier
still resolves as allowed). A third test confirms the fail-closed case: a specifier pointing at a name that
does not exist under ANY extension, anywhere, is rejected rather than defaulting to permissive.

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
  could honestly build now. **This same assumption — that a `Delta.path` names one exact leaf, and that
  `"append"` means the leaf did not exist before — is ALSO load-bearing in `consistency.ts`'s Layer-1
  `"append"` handling, not only in `path.ts`. A future reopening of this assumption (M5 or M6) must update
  both files together; `path.ts`'s own header now cross-references this note so the two don't drift apart
  silently.**
- Negative / cost: requiring `project()` to be synchronous (Decision 1) forecloses a genuine, real-store
  Approach-B implementation over an async-only transactional substrate, AND — confirmed by independent
  verification, not merely a theoretical residual — does not foreclose an adapter module prefetching a real
  network/LLM call via ESM top-level `await`, which the grep-based architectural test cannot see because a
  real adapter's module lives in `domains/**`, outside `lib/simulate/**`'s scanned boundary entirely.
  Accepted for this plan's own demo domains (all synthetic and in-memory per §0.4) and recorded as a named,
  unresolved forward note for M6, not something this milestone's synchronous-signature choice actually
  closes.
- Negative / cost, stated honestly and narrowly: purity is DETECTED, not structurally GUARANTEED, for an
  adapter's own internal behavior — and even that detection is scoped to impurity that manifests in the
  RETURNED effect between two calls with identical input, confirmed (Decision 6) to miss an adapter that
  reads the clock/randomness without using it, one that only turns impure after several calls, or one that
  is impure only for an untested input. This is the one success criterion this milestone can only partially
  deliver on by construction, and `simulate.ts`'s header, `adapter.ts`'s header, this ADR, and
  `__tests__/purity.test.ts` all now say so in the same, narrowly-scoped words rather than several
  differently-hedged claims.

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
- Checking only the TEXTUALLY resolved import path (Decision 8) — misses a real symlink, confirmed with a
  working exploit, that makes a textually-contained path resolve to real, external code at runtime.
- Replacing the textual containment check with a realpath-only one (Decision 8) — loses the ability to
  distinguish a pure `../`-escape from a symlink escape, and repeats the "one clever combined check" mistake
  this repo's own drift-guard history already argues against.
- `realpathSync`-ing the resolved leaf with no directory-level fallback (Decision 8) — would reject every
  ordinary `.js`-to-`.ts` specifier this milestone's own source actually uses, not just an attack.
- Comparing a realpath'd candidate against un-realpath'd allowed roots (Decision 8) — produces false
  rejections the moment the repository itself sits under a symlink, a real condition on macOS.

<!-- Copy this file to NNNN-<slug>.md for each irreversible decision.
     Then add a one-line pointer in wiki/index.md if it becomes something later milestones need to find. -->
