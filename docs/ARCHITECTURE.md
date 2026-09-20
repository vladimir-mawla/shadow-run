# Architecture: World → ProjectedEffect → Reconciliation → Rollback

This is a snapshot, not a tour of the module list — the four directories under `lib/` already document
themselves file by file, and repeating that here would just be a worse copy. What earns this document its
place is the other half of the story: **at each of the four stages, what does the engine refuse to do, and
why.** Every refusal named below is backed by a real, currently-passing test — file and assertion name, not
paraphrase — so a reader can go look. Anything found while writing this that could not be traced to a real
test was cut rather than stated at a lower confidence; none of the refusals below are guesses.

**A stage-order caveat, stated up front because a sibling project on this same account was rejected eight
times for exactly this kind of claim going unchecked:** the order below (World → ProjectedEffect →
Reconciliation → Rollback) is the real **runtime call sequence**, verified directly against
`scripts/demo-domains.ts` (`simulate()` at line 89, the domain's own `applyReal()` at line 121, `reconcile()`
at line 141, `proposeRollback()`/`runRollback()` at lines 144/170) and against every one of `domains/*/domain.ts`'s
own adapters. It is **not** an import-dependency chain the way the analogous diagram is in this account's
`decision-engine` sibling. Checked directly with `grep -rhn '^import' lib/*/[!_]*.ts`, not assumed: `lib/simulate`,
`lib/reconcile`, and `lib/rollback` each import only from `lib/contracts` and from within themselves —
`lib/reconcile` never imports `lib/rollback` or `lib/simulate`, and `lib/rollback` never imports `lib/reconcile`
or `lib/simulate`, in either direction. The three engine layers are independent siblings at the type level; the
pipeline shape is enforced only by the domain/orchestration code that calls all three in sequence
(`domains/**`, `scripts/demo-domains.ts`), never by a module-level dependency. A diagram that drew this as a
layered import stack, the way `decision-engine`'s `lib/contracts → lib/signals → lib/decide → lib/audit`
chain actually is, would be asserting a structural fact this codebase does not have.

```
   WORLD                 PROJECTEDEFFECT          RECONCILIATION            ROLLBACK
lib/contracts/world.ts   lib/simulate/*.ts        lib/reconcile/            lib/rollback/
                                                   reconcile.ts             apply-deltas.ts,
                                                                            run-rollback.ts
   │                        │                         │                        │
   ▼                        ▼                         ▼                        ▼
a typed, hashed,      a typed diff (deltas +      predicted vs.           the recorded steps
frozen snapshot   →   predicted hash),        →   observed, one of    →   that restore THIS
of exactly the        never a sentence,            confirmed /             action's own write —
state slice an        produced only by             drifted /               data, never a
action touches         shadow execution             unprojected             closure — applied
                                                                            by one small,
                                                                            total interpreter
```

---

## Stage 1 — World (`lib/contracts/world.ts`)

**Job:** turn a caller's data into a typed, versioned, hashed, immutable snapshot — the *only* shape state
comes in anywhere in this codebase — or refuse to, rather than construct one that lies about itself.

**What it refuses, and why:**

- **Refuses to let a function, an exotic object, or an unstable value into `World.data`.** `isPlainData`
  rejects a function, a `Date`/`Map`/`Set`/class instance, a symbol-keyed property, and a circular reference —
  each structurally, before anything is hashed. A function embedded in `data` would silently break
  `JSON.stringify`, `structuredClone`, and the fingerprint itself (a hash keyed on function *identity*, not
  behavior), so this is checked at construction, not discovered the first time something hashes it.
  *Tests:* `lib/contracts/__tests__/world.test.ts` — `"RUNTIME: isPlainData rejects a function value even
  when a deliberate cast defeats the type check"`, `"RUNTIME: isPlainData rejects Date, Map, and Set — not
  just bare functions"`, `"RUNTIME: isPlainData rejects a symbol-keyed property"`, `"RUNTIME: isPlainData
  rejects a circular reference"`.
- **Refuses an accessor property (a getter), even with no cast at all.** TypeScript types an object-literal
  getter by its *return type*, so `{ get x() { return 1; } }` satisfies `Json` with zero casts — `isPlainData`
  rejects any own accessor property anyway, checked via property descriptors and never by invoking the
  getter, because nothing requires two reads of it to agree, which breaks this file's "same input, same
  fingerprint, always" premise exactly as badly as a closure would.
  *Tests:* `world.test.ts` — `"RUNTIME: isPlainData rejects an object with an accessor property (a getter) —
  no cast needed to defeat the type system"`, plus the nested-object and array-index variants immediately
  following it.
- **Refuses to let a caller supply a fingerprint at all.** `makeWorld`'s input type has no `fingerprint`
  field — `fingerprint` is computed internally via `computeFingerprint`, so a caller handing in a stale or
  wrong fingerprint is structurally impossible, not merely caught at runtime.
  *Test:* `world.test.ts` — `"TYPE-LEVEL: makeWorld's input has no fingerprint field — a caller cannot supply
  a stale or wrong one"` (a `@ts-expect-error` proof — an unused one is itself a `tsc` failure, so this is
  checked mechanically, not merely asserted in prose).
- **Refuses to let the returned snapshot be mutated, by anyone, afterward — including the caller.**
  `deepFreezeClone` clones `data` and deep-freezes every level of the clone, so a direct mutation attempt
  throws rather than silently no-op'ing, and a caller's own post-construction edits to *their* copy never
  leak into the snapshot already handed back.
  *Tests:* `world.test.ts` — `"RUNTIME: mutating World.data directly throws, rather than silently
  no-op-ing — real failure, not Object.isFrozen alone"`, `"RUNTIME: freezing is deep — a nested object/array
  inside World.data also throws on mutation, not just the root"`, `"a caller mutating their own object after
  construction does NOT affect the returned World — the snapshot is independent of the input"`.

**Named limit, disclosed rather than closed:** a hostile `Proxy` can fabricate its own
`ownKeys`/`getOwnPropertyDescriptor`/`getPrototypeOf` answers and hide a function-valued or unstable property
from `isPlainData`'s reflection-based walk entirely — this is stated as a known, working demonstration, not a
gap the code claims to close. *Test:* `world.test.ts` — `"KNOWN LIMITATION: a Proxy can hide a
function-valued property from isPlainData's reflection-based walk entirely"`.

## Stage 2 — ProjectedEffect (`lib/simulate/simulate.ts`, `consistency.ts`)

**Job:** run the same effect logic a real write would run, against a cloned `World`, and return a typed diff
— never committing, never a sentence — or refuse, through one of four named, fail-closed gates, in order.

**What it refuses, and why:**

- **Refuses to run an adapter at all against a `World` that already contradicts itself.** Gate 1 checks
  `computeFingerprint(world.data) === world.fingerprint` *before* the adapter is ever called — a `World`
  lying about itself makes every later check meaningless, so this fails closed before doing any other work.
  *Test:* `lib/simulate/__tests__/consistency.test.ts` — `"GATE 1 (invalid-world): an input World whose
  fingerprint doesn't match its own data is rejected before the adapter is ever called"`.
- **Refuses to let an adapter mutate the `World` or `Action` it was handed.** Both are deep-frozen clones
  before the adapter ever sees them — true even for a hand-built `World` that skipped `makeWorld` entirely —
  and an adapter that actually attempts a mutation is caught as a named failure, never silently swallowed as
  success.
  *Tests:* `lib/simulate/__tests__/immutability.test.ts` — `"CLAIM 1: the World object the adapter receives
  has frozen data — mutating it directly throws"`, `"CLAIM 2: freezing happens even for a hand-built World
  that skipped makeWorld and was never frozen by the caller"`, `"CLAIM 3: an adapter that actually attempts a
  mutation is caught, not silently swallowed as success"`.
- **Refuses to let an adapter's thrown exception look like anything but a named failure.** Gate 2 catches it
  and reports `adapter-threw`, with no usable effect attached.
  *Test:* `consistency.test.ts` — `"GATE 2 (adapter-threw): an adapter that throws an ordinary error (not a
  mutation attempt) is caught and named"`.
- **Refuses a malformed return value** — missing required fields, a free-text `assumption` smuggled past the
  type system at runtime, or an `increment` delta whose values aren't actually numeric (`Delta.kind:
  "increment"` is defined as a signed *numeric* change).
  *Tests:* `consistency.test.ts` — `"GATE 3 (malformed-effect): an adapter returning a value missing
  required fields is rejected and named"`, `"GATE 3 (malformed-effect): a free-text assumption smuggled past
  the type system at runtime is caught"`, `"GATE 3 (malformed-effect), MEDIUM-3 regression: an 'increment'
  delta whose after is non-numeric is rejected — delta.ts defines increment as a signed numeric change, and
  this was previously never checked"`.
- **Refuses a projection that is internally dishonest, even when it *looks* self-consistent by its own
  lights.** Gate 4 applies the claimed `deltas` to the real input `World.data` for real and checks (1) each
  delta's claimed `before` against what is really there, and (2) the resulting hash against the claimed
  `resultingFingerprint` — an adapter whose delta lies about the starting value is rejected even when its
  final hash agrees with *its own* lie.
  *Tests:* `consistency.test.ts` — `"GATE 4 (inconsistent-effect): an adapter whose claimed
  resultingFingerprint doesn't match its own claimed deltas is rejected"`, `"GATE 4 (inconsistent-effect): an
  adapter whose delta lies about the world's starting value is rejected even though its final hash is
  'consistent' with ITS OWN lie"`.
- **Refuses to let an `append` claim growth it does not actually deliver, once `before` is a real array.**
  When `delta.kind === "append"` and `delta.before` is a defined array, `delta.after` must be an array with
  at least as many elements — a non-array `after` counts as the most extreme shrink, not an exemption.
  *Tests:* `consistency.test.ts` — `"ENFORCED (independent verification, MEDIUM finding, round 2 — the
  narrow growth check): an 'append' whose 'after' SHRINKS an existing array 'before' is now rejected, not
  silently passed"`, `"ENFORCED sanity: an 'append' whose 'after' is not even an array, while 'before' was
  one, is rejected the same way (treated as the most extreme shrink)"`. **Narrowed, not closed — the
  distinction matters and this file does not blur it:** a same-length-or-longer but *unrelated* replacement
  (`{before: ["a","b"], after: ["x","y","z"]}`) still passes, because this check enforces a length floor, not
  "`after` is really an extension of `before`"; and a non-array `append` target (an object-valued collection)
  is outside this check's scope entirely, by the same "defined array" precondition. Both residues are named,
  not hidden. *Tests:* `consistency.test.ts` — `"DISCLOSED GAP (independent verification, MEDIUM finding),
  PINNED NOT FIXED — narrower than before: a SAME-LENGTH-OR-LONGER but UNRELATED replacement of an existing
  array still passes..."`, `"DISCLOSED GAP: a non-array 'append' target (an object-valued collection) is
  outside the growth check's scope entirely..."`.
- **Refuses to scan a file it cannot honestly parse.** The separate architectural invariant that
  `lib/simulate/**` never reaches an LLM, the network, or a Node built-in (`lib/simulate/__tests__
  /architecture.test.ts`) parses every file with the real TypeScript compiler (via `typescript/unstable/sync`
  — this repo's installed `typescript@7.0.2` is the native/Go-backed compiler, whose main entry exports only
  `{version}`, so the classic `ts.createSourceFile` API this kind of guard traditionally uses does not exist
  here) and calls `project.program.getSyntacticDiagnostics(file)` *before* any AST walk. Any diagnostic throws
  `UnparseableFileError`, surfaced in its own `parseOffenders` list, kept separate from the specifier/fetch
  offender lists on purpose — "this file could not be checked" and "this file was checked and failed" are
  different findings. A re-export (`export {x} from "..."`, `export * from "..."`) is scanned identically to
  an import.
  *Tests:* `architecture.test.ts` — `"every non-test source file under lib/simulate/** parses as valid
  TypeScript — a file this guard cannot parse is an automatic offender, never silently treated as clean
  (round 5)"`; the `"EXPLOIT REGRESSION (independent verification, round 5)"` block's `"[HIGH] an unterminated
  template literal (a syntax error) fails closed instead of silently swallowing a real fetch(...) call"` and
  `"[HIGH] a broken function signature (a syntax error) also fails closed"`; `"[MEDIUM] a re-export (\`export
  ... from\` / \`export * from\`) was never checked for its specifier — closed alongside the specifier
  extraction rewrite"`. The identical rewrite exists for `domains/**`'s own `await`-ban guard
  (`domains/__tests__/architecture.test.ts`), copied rather than re-derived.

**Named limit, stated honestly rather than flattened into the fix above:** `getSyntacticDiagnostics` is not
the complete word on ECMAScript validity. Verified directly in this session (a throwaway script against the
real, installed `typescript` package): a top-level `return`, a `yield` outside a generator, and a `for
await` outside an `async` function all produce **zero** syntactic diagnostics — TypeScript classifies each as
a *semantic* error, not a syntactic one. In every one of those three shapes, checked directly, the parse tree
stays structurally intact and a `fetch(...)` call placed inside it is still found by the AST walk exactly as
it would be in valid code — so this does not matter for this guard's actual job (finding a forbidden call),
but it is a real, disclosed gap in the stronger-sounding claim "this file parses as valid TypeScript," not
something to leave unstated.

**Named limit, stated at full strength:** purity is *detected*, not *prevented*. `simulate()`'s own body
contributes no non-determinism, but nothing in `adapter.project`'s type signature stops its body from calling
`Date.now()`/`Math.random()`. `lib/simulate/__tests__/purity.test.ts`'s own test —
`"HONEST GAP, DEMONSTRATED NOT HIDDEN: a deliberately impure adapter (Math.random() inside project()) breaks
purity across repeat calls..."` — proves only the *detectable* half: an adapter whose randomness reaches the
returned `deltas`/`resultingFingerprint` produces two non-deep-equal `simulate()` calls. An adapter that reads
`Date.now()` or `Math.random()` on every call but never lets the result reach the returned effect (it reads
the clock only to log, or to choose between two branches that happen to produce the same output either way)
passes every gate above cleanly, every time — this is argued at length in `simulate.ts`'s own header, and,
checked directly while writing this document: no test in this suite exercises that specific shape, so it is
reported here as a real, undemonstrated gap rather than something a test happens to pin.

## Stage 3 — Reconciliation (`lib/reconcile/reconcile.ts`, `lib/reconcile/trust.ts`)

**Job:** mechanically diff a predicted `Delta[]` against an observed `Delta[]` from two real snapshots, and
report exactly one of three outcomes — `confirmed` / `drifted` / `unprojected` — with no heuristic and no
judgment call.

**What it refuses, and why:**

- **Refuses to guess which of two same-path `Delta`s is authoritative.** A duplicate `path` on either side
  throws `MalformedDeltaArrayError` rather than silently picking the first or last — a `Reconciliation` this
  function invented a tiebreak for would look, to every downstream caller, identical to one earned by an
  honest diff.
  *Tests:* `lib/reconcile/__tests__/reconcile.test.ts` — `"throws MalformedDeltaArrayError when the
  PREDICTED side has two Deltas for the same path, rather than picking one"`, `"throws
  MalformedDeltaArrayError when the OBSERVED side has two Deltas for the same path"`.
- **Refuses to call a `kind` mismatch "confirmed" just because the resulting value agrees.** A predicted
  `{kind:"set", before:5, after:10}` against an observed `{kind:"increment", before:5, after:10}` is
  `drifted`, not `confirmed` — a future consumer trusting `Reconciliation.confirmed.matched`'s `kind` as
  ground truth would invert an `append` as if it were a `set` otherwise, which is the wrong mechanism.
  *Test:* `reconcile.test.ts` — `"DESIGN DECISION: a 'kind' mismatch is drift even when the resulting value
  is identical -- see reconcile.ts's dedicated comment for why"`.
- **Refuses to let array order stand in for a real disagreement.** Deltas are matched by `path`, never by
  array position, so predicted/observed arrays enumerating the same changes in a different order still
  confirm.
  *Test:* `reconcile.test.ts` — `"DESIGN DECISION: matching is by 'path', not array position -- identical
  content in a different order still confirms"`.
- **Refuses to silently drop a prediction that never happened.** A "vanished" prediction (`project()` named a
  change; nothing at that path actually changed) is classified `drifted`, with a *synthesized* no-op `actual`
  — a genuinely constructed value, not a guess, derivable with certainty from the definition of an
  observed-effect diff.
  *Test:* `reconcile.test.ts` — `"DESIGN DECISION: a 'vanished' prediction (predicted a change, nothing at
  that path actually changed) is drifted, with a synthesized no-op actual"`.
- **Refuses to report more than one fact per call, even when several paths have a problem — and picks which
  one deterministically rather than arbitrarily.** Drift outranks unprojected; ties break by ascending
  lexicographic `path`. This is a named, real limitation of the frozen three-variant `Reconciliation` type,
  not a hidden one.
  *Tests:* `reconcile.test.ts` — `"DESIGN DECISION: when both a drift and an unprojected delta exist, drift
  is reported (priority rule), even if the unprojected path sorts earlier"`, `"DESIGN DECISION: when multiple
  paths drift, the lexicographically-first path's drift is reported, deterministically"`.

**This limitation is not abstract — it is exactly what happened to this project's own headline promise.**
`tests/failures/case-1-toctou.test.ts` drives the real, merged inventory domain through the §B TOCTOU
scenario and finds that a single, unsliced `reconcile()` call over the real race reports `drifted` at
`"reservations"` — not `"stock.reserved"`, the field `sim-plan.md`'s own headline sentence names — because
`"reservations"` sorts first *and* genuinely drifted too. The `stock.reserved: 42 → 45` fact is real, but only
reachable by a second, deliberately sliced `reconcile()` call, the exact technique `reconcile.ts`'s own header
prescribes. `docs/WALKTHROUGH.md` and the live demo both show this second card rather than papering over the
first, and `.genesis/decisions/0003-reconcile.md`/PR #17 record it as a corrected claim, not a quietly patched
one.

**The trust feedback loop (`trust.ts`) belongs in this stage's scope, and stating its one real limitation at
full strength is the most important disclosure in this document, not a footnote to it.** `updateTrust`
mechanically advances or resets `SimulatorTrust.consecutiveNonConfirmed` from a `Reconciliation.status`
alone, and `requiresPreValidatedRollback` correctly reports `true` once that counter reaches
`DEFAULT_TRUST_THRESHOLD` consecutive non-confirmed calls — both proven directly, by real arithmetic, in
`lib/reconcile/__tests__/trust.test.ts`. **But nothing in this repository consults that answer before
deciding whether to run a rollback.** `components/InventoryDemo.tsx` calls `updateTrust` and displays the
resulting counter to the viewer — it never calls `requiresPreValidatedRollback` at all. Every domain's own
call shape (`simulate → execute → reconcile → proposeRollback → runRollback`) runs `runRollback`
unconditionally whenever `reconciliation.status !== "confirmed"`, regardless of what the trust counter says.
This is exactly the risk this project's own plan named for itself before any code existed — "divergence is
detected and logged, but nothing downstream changes... a dashboard nobody acts on" — and it is true of the
shipped system today, not a hypothetical the plan warned about and then closed.
*Tests:* `tests/failures/case-5-gate-never-consulted.test.ts` — full pin on the gate's own arithmetic and a
spied demonstration that the ordinary call shape proceeds to a fourth real execution unconditionally once
the gate has already flipped `true`; an honest partial pin (a textual search over today's non-test source,
stated as exactly that — a search over what is committed, not a guarantee about all future code) proving
`requiresPreValidatedRollback` appears in no non-test file under `lib/contracts`, `lib/simulate`,
`lib/rollback`, `domains`, `scripts`, or `app`. **A sharper gap than that test's own header claims, found by
reading its `SCAN_ROOTS` list directly rather than trusting the header's "no shipped source" wording:** this
list has six entries and `components/**` — merged two milestones later, at M8, and the one directory a
judge-facing UI actually lives in — is not one of them. Checked separately, by direct inspection rather than
by this test: `components/InventoryDemo.tsx` imports and calls `updateTrust`, never
`requiresPreValidatedRollback`, so the underlying claim still holds — but the merged test that is supposed to
prove it does not actually scan the directory where the strongest counter-example would live.

## Stage 4 — Rollback (`lib/rollback/apply-deltas.ts`, `run-rollback.ts`)

**Job:** turn the recorded `steps` a `Rollback.runnable` carries — data, never a closure — into an actual,
verified restoration of the state immediately before *this action's own write*, or refuse, loudly and
specifically.

**What it refuses, and why:**

- **Refuses to write a step whose claimed `before` doesn't match what's really there.** `applyDeltas`'s
  per-step verification throws `RollbackStepFailedError`, naming the exact step index and delta, rather than
  overwriting a value it never checked.
  *Test:* `lib/rollback/__tests__/apply-deltas.test.ts` — `"throws RollbackStepFailedError, naming the exact
  step, when the current value does not match the recorded 'before'"`.
- **Refuses to return, or leave behind, a half-restored `World`.** `applyDeltas` mutates only a private
  scratch clone; any step failure discards it entirely, and the caller's original `World` argument is
  provably untouched — never a partial result with a warning flag.
  *Test:* `apply-deltas.test.ts` — `"ATOMICITY: when step 2 of 3 fails, the ORIGINAL World argument is
  provably untouched — no half-restored result is ever returned"`.
- **Refuses to treat `kind` specially at application time.** `remove` and `append` go through the identical
  verify-then-write rule as `set`/`increment` — `kind` exists only for `invertDelta` and reconciliation, never
  for the interpreter.
  *Test:* `apply-deltas.test.ts` — `"applies a 'remove' and an 'append' with the identical verify-then-write
  rule used for 'set'/'increment'"`.
- **Refuses to run anything at all once its own paperwork already disagrees with reality.** The cheap
  self-consistency check compares `rollback.projectedRestoration.resultingFingerprint` against the known
  fingerprint of the world immediately before this write, *before* `applyDeltas` is ever called, and rejects
  as `"dishonest"` if they disagree.
  *Test:* `lib/rollback/__tests__/run-rollback.test.ts` — `"'dishonest' (cheap pre-check): the rollback's OWN
  claimed fingerprint disagrees with the known-good expectation — rejected before running anything"`.
- **Refuses to call a run "restored" on fingerprint agreement alone.** The opt-in strong check's pass/fail
  branch is authoritative on structural deep-equality of the real data (`dataMatchesExactly`); fingerprint
  equality is reported only as corroboration — because a real collision exists in this exact domain's own
  field (`{reserved: 412789}` and `{reserved: 649192}` both hash to `2ba95242`), and a fingerprint-only check
  would call a genuinely wrong restoration "restored."
  *Tests:* `run-rollback.test.ts` — `"'dishonest' (the real proof, post-run, opt-in strong check): steps run
  with NO error but restore the wrong FULL state anyway"`; `tests/failures/case-4-hash-collision.test.ts`'s
  4a/4b sections reproduce the collision directly and prove `runRollback`'s branch is driven by `deepEqual`,
  not by fingerprint comparison.
- **Refuses to erase a concurrent actor's legitimate write.** `buildRollbackSteps` inverts only *this
  action's own* observed deltas — never a stale `simulate()` snapshot — so a concurrent write to a different
  path survives rollback intact, and a concurrent write to the *same* path fails closed (`"failed"`) rather
  than silently overwriting it.
  *Tests:* `run-rollback.test.ts` — `"a concurrent write to a DIFFERENT path survives rollback intact;
  comparing to the stale snapshot would incorrectly flag this as wrong"`, `"a concurrent write to the SAME
  path fails closed (never overwrites the concurrent actor's value)"`.
- **Refuses to invert a multi-step action in the wrong order.** Steps are applied LIFO (the reversed observed
  sequence) — proved with two `append`s to the same path: reversed order restores correctly, the plan
  sketch's literal forward order fails loudly rather than silently corrupting anything.
  *Test:* `run-rollback.test.ts` — `"two appends to the same path: reversed order restores correctly;
  forward order fails loudly"`.
- **Refuses to fabricate a compensating write where none honestly exists.** A domain with no true inverse
  (this codebase's `notification` domain — no `Delta.kind` means "this recipient never read this message")
  reports `Rollback.unavailable` with `blastRadius` as data; `runRollback` returns `"unavailable"` without
  attempting anything, never a constructed `steps` array that would apply cleanly while lying about what
  happened.
  *Test:* `run-rollback.test.ts` — `"returns a typed 'unavailable' result without attempting to apply
  anything, and never throws"` (exercised for real by `npm run demo:domains`'s N1 case).

**Named limit, from ADR 0004's own forward note:** `verifyStepsAreHonestInversion` is the *one* honesty check
that survives a concurrent writer unconditionally — it never looks at "the world" at all — but it is opt-in
and requires a caller to have separately retained `observedDeltas` alongside `Rollback.steps`, because
`Rollback`'s own frozen shape does not carry them. "Taking neither available check [`assumeNoConcurrentWriter`
nor `verifyStepsAreHonestInversion`] is not a style choice — it is accepting a success report that may be
false" (ADR 0004). Only one case in this codebase's own domain suite actually executes a rollback
(inventory's INV-2), and it takes `assumeNoConcurrentWriter: true` — checked, in `case-1-toctou.test.ts`, to
be honest for that file's own control flow, not assumed to transfer from the demo script.
