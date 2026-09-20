# ADR 0003 — Reconciliation: matching by `path`, `kind` as part of equality, and the trust counter's reset-on-success rule

- **Date:** 2026-09-20
- **Status:** accepted
- **Phase / milestone:** M4 (BUILD) — `lib/reconcile/**`

## Context

`lib/contracts/**` (M1, frozen) fixes `Reconciliation`'s shape at exactly three variants
(`confirmed`/`drifted`/`unprojected`) and `SimulatorTrust`'s shape at a plain counter. Neither file
implements the arithmetic that produces those values — that is this milestone's job, entirely within
`lib/reconcile/**`, without touching `lib/contracts` (verified: `git diff main -- lib/contracts` is
empty). This ADR records the design questions the milestone brief asked to be answered deliberately,
not glossed over, plus the alternatives rejected for each.

## Decision 1 — Delta matching is by `path`, never by array position

**Alternatives considered:**

- **Match by array position** (`predicted[i]` vs `observed[i]`). Rejected outright: `project()` (M3) and
  the real snapshot-diff step that derives an `ObservedEffect` (M6) have no reason to visit a
  `World.data` object's fields in the same order as each other — JS object/array enumeration order is an
  implementation detail neither side should be forced to replicate just to avoid a false positive. An
  approach whose entire value proposition is "a divergence it reports is real" cannot itself be a source
  of spurious divergence.
- **Chosen: match by `Delta.path`.** Each side (`predicted`, `observed`) is indexed into a
  `Map<path, Delta>` before any comparison happens (`indexByPath`, `reconcile.ts`). This directly answers
  the milestone's own question — "what if order differs but content is identical, is that confirmed or
  drifted?" — with **confirmed**: order was never part of what this system claims to predict; the set of
  changed paths and their values is. `__tests__/reconcile.test.ts` proves this directly (feeding the same
  two deltas in reversed order on each side still confirms).

## Decision 2 — What "two deltas sharing a path" means, and why it is a fail-closed error, not a tiebreak

**Alternatives considered:**

- **Keep the first occurrence, silently.** Rejected: this launders a real data-integrity bug (an upstream
  `project()` or snapshot-diff step that produced two entries for the same field, which should never
  happen if either is a correct diff — see `delta.ts`'s own framing of a `Delta[]` as "one shape, four
  consumers") into a confidently wrong `Reconciliation`, indistinguishable on the outside from an honest
  one.
- **Merge the two deltas somehow** (e.g. compose them into a single net change). Rejected: there is no
  general, non-arbitrary way to compose two `Delta`s of possibly different `kind`s into one without
  inventing semantics the frozen `Delta` vocabulary (`delta.ts`) does not define, and the plan's own
  discipline (ADR 0001, Decision 5's "no expression language nobody asked for") argues against inventing
  vocabulary to paper over a case the type wasn't designed for.
- **Chosen: throw `MalformedDeltaArrayError`.** `reconcile()` refuses to produce any `Reconciliation` at
  all for a side with a duplicate `path`, naming which side and which path. This is the direct answer to
  "is reconciliation total?" (see Decision 5, below) and is proven by two dedicated tests in
  `__tests__/reconcile.test.ts` (one per side).

## Decision 3 — `kind` is part of Delta equality, not just the resulting value

The single sharpest question the brief asked directly: "if `kind` differs but the resulting value is the
same, is that drift?"

**Alternatives considered:**

- **Compare only `before`/`after` (the resulting value), ignore `kind`.** This is the more "obvious"
  choice at first glance — if the field ends up the same value either way, why call it drift? Rejected,
  for a load-bearing reason, not a stylistic one: M5's `invertDelta` (`lib/rollback/**`, sim-plan.md §A.4)
  dispatches on `Delta.kind` to decide HOW to invert a delta — `set`/`increment` invert by swapping
  `before`/`after`, but `remove` inverts to a `set` and `append` inverts to a `remove` (asymmetric on
  purpose). A `kind` mismatch that reconciliation waved through as "confirmed, because the value matched"
  would still be recorded as if the projection had been fully right — and if a later stage ever builds a
  rollback plan from that projection's `kind` rather than the observed one, it inverts the WRONG way while
  every earlier check said everything was fine. Reconciliation is this project's only mechanical
  checkpoint before that could happen.
- **Compare `World.fingerprint`/`resultingFingerprint` instead of individual Delta fields.**
  Not applicable at this layer: `reconcile()` operates on `Delta[]`, not `World` values — it has no access
  to a fingerprint here, and `resultingFingerprint` already exists on `ProjectedEffect` to answer "did the
  state end up the same." `Reconciliation`'s job is the stronger, different claim that the recorded
  MECHANISM of change also matched, because that recorded mechanism is what a rollback later trusts.
- **Chosen: `deltasMatch` requires `kind === kind` AND deep-equal `before` AND deep-equal `after`.**
  Proven directly by a dedicated test: a predicted `{ kind: "set", before: 39, after: 42 }` reconciled
  against an observed `{ kind: "increment", before: 39, after: 42 }` at the same path is `drifted`, even
  though the field's value transition is identical.

`before`/`after` are compared with a small local `deepEqual` (`deep-equal.ts`), not `===` and not
`JSON.stringify` comparison. `Object.is` is used for primitives specifically so two `NaN`s (a realistic
byproduct of a domain's counter arithmetic) compare equal rather than spuriously drifting, while `-0`
and `0` compare unequal (the more conservative choice for a system whose entire purpose is noticing small
discrepancies). `JSON.stringify`-based comparison was rejected because it handles `undefined`/functions/
`NaN` inconsistently and would need to re-implement `fingerprint.ts`'s own key-sorting `canonicalize` a
second time for no reason.

## Decision 4 — The "vanished prediction" case: a fourth input shape the plan's three examples didn't name

The plan (§A.3) names three cases by example — identical deltas, a mismatched field, an observed-only
delta — but does not name what happens when `project()` predicted a change at some `path` and the real
execution's diff has **no entry there at all** (the field simply did not change). This is not
`unprojected` (nothing unpredicted happened) and it cannot be silently `confirmed` (something WAS
predicted and did not occur).

**Alternatives considered:**

- **Silently drop it** (treat "no observed counterpart" as if the prediction were never made). Rejected:
  this is the exact failure mode plan §E.3 names — "divergence is detected and logged, but nothing
  downstream changes" — except worse, because here the divergence would not even be logged. A domain
  whose `project()` predicts a change that never happens (e.g. a reservation that silently fails) would
  never show up as anything but a clean run.
- **Add a fourth `Reconciliation` status** (e.g. `"vanished"`). Rejected because it is out of scope for
  this milestone by construction: `lib/contracts/**` is frozen after M1, and the milestone brief is
  explicit that a genuine contracts need must be reported to the orchestrator, not invented here. It was
  considered and set aside for that reason, not because it is a bad idea in the abstract.
- **Chosen: classify as `drifted`, with a SYNTHESIZED `actual` Delta**: `{ path, before: predicted.before,
  after: predicted.before, kind: "set" }`. This is a genuinely constructed value, not something literally
  observed — but it is derivable with certainty, not guessed: an `ObservedEffect` is defined (plan §A.3
  step 3) as a diff between two real snapshots, so the ABSENCE of an entry at a path is itself the fact
  that the value at that path did not change, and the pre-execution value is already known
  (`predicted.before`, since the projection ran against that same real, pre-execution `World`). `kind:
  "set"` is used because "no change occurred" has no natural home in `increment`/`remove`/`append`'s
  asymmetric semantics, and replacing a value with itself is the most literal expression of "nothing
  moved" available in the existing four-`kind` vocabulary.

## Decision 5 — Is `reconcile()` total? Yes, over well-formed input; fail-closed, not fail-silent, otherwise

Directly answering the milestone's question: `reconcile()` is **total** for every pair of Delta arrays
that are individually well-formed (at most one `Delta` per `path`, checked independently per side — the
two sides are never required to share any paths at all). Every such pair reaches exactly one of the three
`Reconciliation` variants; there is no well-formed input shape this function fails to classify.

Over **malformed** input (a duplicate `path` within one side — Decision 2), `reconcile()` is deliberately
**partial**: it throws rather than returning any `Reconciliation` value. "Fail closed" means exactly that
here — refusing to produce a value at all, rather than returning a plausible-looking one built on an
arbitrary tiebreak, because a `Reconciliation` this function invented a resolution for would be
indistinguishable, to every downstream caller, from one earned by an honest diff.

## Decision 6 — Multiple simultaneous drifts/unprojected deltas: a deterministic priority rule, named as a real limitation

`Reconciliation.drifted` carries exactly one `expected`/`actual` pair; `.unprojected` carries exactly one
`actual`. The frozen type has no room to report "three fields all drifted at once" from a single call.

**Chosen rule:** candidates are considered in ascending lexicographic order of `path`. Any drift-class
mismatch (a shared path whose deltas disagree, or a "vanished" prediction, Decision 4) is checked in a
first pass, over ALL paths, before any `unprojected` extra delta is considered in a second pass — so a
drift always outranks an unprojected delta, even one that would sort earlier by path. This is a
deliberate priority choice, not an accident of loop order, proven by a dedicated test that constructs an
unprojected delta at a lexicographically-earlier path than the drift and asserts the drift still wins.

**Why this ordering, and not the reverse:** a drift is evidence the simulator was confidently WRONG about
a path it claimed to understand fully — a stronger, more specific falsification of the shadow-execution
premise (plan §A.2) than "something extra happened that nothing was claimed about at all." `SimulatorTrust`
(Decision 7) does not care which of the two non-`confirmed` statuses it is told about — both increment the
counter identically — so this priority choice only affects which single fact a human or verifier sees on
screen from one call, never whether the trust gate advances.

**Stated limitation, not hidden:** a caller that needs to see every drifted/unprojected path from one
execution, not just the first, must call `reconcile()` per-path itself (e.g. by slicing the two `Delta[]`s
down to one path each first). This function reports one fact per call because that is what the frozen
`Reconciliation` type can carry — extending it to carry more is a `lib/contracts` change, out of this
milestone's scope.

## Decision 7 — `SimulatorTrust`: reset-on-success, and where the threshold lives

The reset-on-success arithmetic itself is not this milestone's decision to make — `simulator-trust.ts`
(M1) and sim-plan.md §A.3 already specify it exactly: `confirmed` resets `consecutiveNonConfirmed` to
`0`; `drifted`/`unprojected` each increment it by exactly `1`; `totalObserved` increments unconditionally.
`updateTrust` (`trust.ts`) implements exactly that, deliberately via `status === "confirmed" ? 0 : n + 1`
rather than an exhaustive switch — `drifted` and `unprojected` are handled identically by the counter, so
there is nothing to gain from re-deriving `assertNeverReconciliation`-style exhaustiveness here (a fourth
`Reconciliation` status, if `lib/contracts` ever grew one, would still correctly fall into the same
"not confirmed → increment" branch without this file needing to know it exists).

**Where the threshold lives, and what stops it drifting from what tests assert:** `DEFAULT_TRUST_THRESHOLD`
is one exported `const` in `trust.ts` (value `3`), and `requiresPreValidatedRollback(trust, threshold =
DEFAULT_TRUST_THRESHOLD)` reads it as its default parameter — there is exactly one number in the whole
milestone, not two kept in sync by convention. `__tests__/trust.test.ts` imports this same constant to
build its "N-1 does not flip, N does" fixture (`DEFAULT_TRUST_THRESHOLD - 1` / `DEFAULT_TRUST_THRESHOLD`
loop counts), rather than hardcoding the literal `3` a second time — so if the constant is ever changed,
the test's notion of "N" moves with it automatically, and cannot silently assert a threshold the code no
longer uses.

**Why `3`, stated as a judgment call, not a derived constant:** small enough that a judge or independent
verifier can watch the counter cross it within a handful of calls (plan §A.3's own framing), and greater
than `1` so that a single bad reconciliation — expected, ordinary noise — never alone flips the gate. There
is no formula in the plan that produces this number; it is named here as a choice, not disguised as
obvious.

**The reset-on-success limitation, proven, not just asserted:** `__tests__/trust.test.ts` includes a test
that runs an alternating `confirmed`/`drifted` sequence for ten times the threshold's length and asserts
the gate never flips — the exact accepted cost plan §A.3 and `simulator-trust.ts` both already name in
prose. This ADR does not soften or restate that limitation more strongly than the code proves; the test
exists specifically so the claim is checked, not merely written down (per this account's standing
"don't restate limits more strongly than they're true" discipline).

## Consequences

- Positive: every one of `reconcile()`'s branch decisions (path matching, `kind`-sensitive equality, the
  vanished-prediction case, the multi-drift priority rule, the fail-closed malformed-input case) is
  independently proven by a named test in `__tests__/reconcile.test.ts`, not merely argued for in this
  document.
- Positive: the trust threshold has exactly one home (`DEFAULT_TRUST_THRESHOLD`), read by both the
  production gate function and its own test's loop bounds — the threshold cannot drift from what the
  tests assert because there is only one number for either to read.
- Negative / cost, stated plainly: `reconcile()` reports only ONE drifted-or-unprojected fact per call,
  even when several paths have problems simultaneously (Decision 6) — a real, scoped limitation of
  working within `Reconciliation`'s frozen three-variant shape, not something this milestone can fix
  without a `lib/contracts` change it does not have authority to make.
- Negative / cost, carried forward from ADR 0001 and restated here because it is the direct cause of
  Decision 6 and this file's whole "which one fact do we report" problem: `Reconciliation.drifted`/
  `.unprojected` each carry exactly one `Delta`-shaped fact by the frozen type's own design — this was
  ADR 0001's call, not this one's, and this ADR inherits it rather than re-litigating it.
- Negative / cost, restated from `simulator-trust.ts` and proven here rather than merely quoted: a domain
  that alternates `confirmed`/`drifted` never trips the trust gate under this reset-on-success counter, no
  matter how long it runs. This is the accepted trade named in ADR 0001's sibling document
  (`simulator-trust.ts`'s own header) and sim-plan.md §A.3; it is not revisited or narrowed here.

## Alternatives rejected (summary, cross-referenced above)

- Matching predicted/observed deltas by array position (Decision 1) — reintroduces false positives from
  ordinary key-order differences.
- Silently keeping the first delta on a duplicate `path`, or merging two same-path deltas (Decision 2) —
  launders a data-integrity bug into a confidently-wrong `Reconciliation`.
- Comparing only the resulting value, ignoring `Delta.kind` (Decision 3) — breaks M5's `invertDelta`
  dispatch silently, one stage downstream.
- Silently dropping a "vanished" prediction, or inventing a fourth `Reconciliation` status for it
  (Decision 4) — the first repeats plan §E.3's named risk; the second is a `lib/contracts` change out of
  this milestone's authority.
- Reporting an arbitrary/unpriorized drifted-or-unprojected fact when several exist at once (Decision 6) —
  replaced with a named, tested, justified priority rule instead of leaving the choice to loop-order
  accident.
- An EMA instead of a reset-on-success counter (Decision 7) — not this milestone's call; already rejected
  in `simulator-trust.ts`/ADR 0001 for reasons restated, not re-argued, here.

<!-- Copy this file to NNNN-<slug>.md for each irreversible decision.
     Then add a one-line pointer in wiki/index.md if it becomes something later milestones need to find. -->
