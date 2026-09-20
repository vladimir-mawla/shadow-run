# shadow-run — process record

Reconstructed from primary sources only: `git log --oneline --all`, `gh pr list --state all`, `gh pr view N
--json body,comments` and `gh api repos/.../pulls/N/reviews` for every PR (1 through 20), the six ADRs under
`.genesis/decisions/`, `.genesis/DONE.html`, `app/milestones.ts`, and `.genesis/checkpoints/CURRENT.md` —
read from the `m9-deliverables` worktree, rebased onto `origin/main` at `48fdd8b` (PR #15's merge, the tip as
of this revision) on 2026-09-20. A stale scratchpad draft of this file exists from before M6, M7, and M8
merged; it is not used as a source for any number below — every count here was re-run against this
repository directly, not carried over. **`origin/main` moved twice while this document was being written,
and both times the correct response was to re-read the repository again rather than patch forward from
memory:** an earlier draft of this section, written while PR #15 was still open, correctly described its
architecture-guard fix as unmerged and a specific bypass in it as still live; by the time this revision was
written, PR #15 had gone through a further review round and then merged (`48fdd8b`). Every claim below about
PR #15 describes what is true of `main` at `48fdd8b`, re-verified directly against that commit, not carried
forward from either earlier draft.

## 1. Milestone state

`.genesis/DONE.html`'s status table and `app/milestones.ts`'s `MILESTONES` array agree exactly, and both are
current (unlike `CURRENT.md` — see §5):

| # | Milestone | Phase | Status |
|---|---|---|---|
| M1 | Contracts: World, ProjectedEffect, Reconciliation, Rollback | BUILD | done |
| M2 | Deploy a live skeleton to Vercel | DEPLOY | done |
| M3 | The shadow-execution engine (`simulate()`) | BUILD | done |
| M4 | Reconciliation and the trust feedback loop | BUILD | done |
| M5 | Rollback engine: compensations that actually run | BUILD | done |
| M6 | Domains: four adapters wired to simulate → execute → reconcile → rollback | INTEGRATE | done |
| M7 | The failure suite (the one deliberate-failure milestone) | VERIFY | done |
| M8 | The interactive demo | BUILD | done |
| M9 | Deliverables | RELEASE | todo (this milestone) |

`main` (`origin/main`, `48fdd8b`) carries **29 test files / 337 tests**, confirmed by running `npm test`
directly in this worktree after rebasing onto `origin/main`'s current tip. Live at
`https://shadow-run-three.vercel.app`. (Before PR #15 merged mid-session, `main` was at `fedde88` — 29
files / 293 tests; PR #15 added 44 tests to existing files, no new test files.)

## 2. Every PR

From `gh pr list --state all --limit 50`, with merge timestamps and `gh api .../pulls/N/reviews` counts:

| # | Title | Branch → base | State | Merged | Reviews |
|---|---|---|---|---|---|
| 1 | M1 — Contracts | `m1-contracts-final` → `empty-base` | CLOSED | — | 0 |
| 2 | M2: Deploy skeleton | `m2-deploy` → `main` | MERGED | 2026-09-19 23:38 | 0 |
| 3 | M1 fixes | `m1-fixes` → `main` | MERGED | 2026-09-19 23:54 | 0 |
| 4 | Mark M2 done | `mark-m2-done` → `main` | MERGED | 2026-09-20 11:07 | 0 |
| 5 | M3: shadow-execution engine | `m3-simulate` → `main` | MERGED | 2026-09-20 11:34 | 0 |
| 6 | M4: Reconciliation + trust loop | `m4-reconcile` → `main` | MERGED | 2026-09-20 11:38 | 0 |
| 7 | Mark M4 done | `mark-m4-done` → `main` | MERGED | 2026-09-20 11:53 | 0 |
| 8 | M5: Rollback engine | `m5-rollback` → `main` | MERGED | 2026-09-20 12:11 | 0 |
| 9 | Bring CURRENT.md up to date | `checkpoint-m4-m5` → `main` | MERGED | 2026-09-20 12:28 | 0 |
| 10 | Mark M3 and M5 done | `mark-m3-m5-done` → `main` | MERGED | 2026-09-20 12:31 | 0 |
| 11 | M7 (PARTIAL): Cases 2, 3, 4 | `m7-failures` → `main` | MERGED | 2026-09-20 13:12 | 0 |
| 12 | Correct Case 4's fingerprint-immunity claim | `fix-m7-fingerprint-claim` → `main` | MERGED | 2026-09-20 13:23 | 0 |
| 13 | M6: Domains | `m6-domains` → `main` | MERGED | 2026-09-20 13:32 | 0 |
| 14 | M8: interactive demo | `m8-components` → `main` | MERGED | 2026-09-20 13:38 | 0 |
| 15 | Fix M3 append rule + architecture-guard bypasses | `fix-m3-append-and-tokenizer` → `main` | MERGED | 2026-09-20 15:41 | 0 |
| 16 | M7: Cases 1 and 5 | `m7-cases-1-and-5` → `main` | MERGED | 2026-09-20 14:08 | 0 |
| 17 | Mark M7 done | `mark-m7-done` → `main` | MERGED | 2026-09-20 14:17 | 0 |
| 18 | Mark M6 done | `mark-m6-done` → `main` | MERGED | 2026-09-20 14:26 | 0 |
| 19 | Mark M8 done | `mark-m8-done` → `main` | MERGED | 2026-09-20 14:39 | 0 |

**Every one of these 19 PRs has zero entries under `gh api repos/.../pulls/N/reviews`** — confirmed directly
for all 19, not assumed from the pattern holding for the first few. GitHub's formal review feature was never
used anywhere in this repository's history; whatever independent verification happened is recorded, if at
all, in PR body prose or a PR issue-comment, never as a `gh`-visible review. PR #1 is `CLOSED`, not merged —
its own body explains why: an early repo-setup error pushed work directly to `main`, and `empty-base` was
created as a clean replacement default branch rather than force-rewriting history.

**PR #15 merged mid-session, as commit `48fdd8b` directly onto `main`'s tip.** For most of this session it
was open — a deliberate, authorized reopening of frozen `lib/simulate/**` and `domains/__tests__/**` to fix
two things independent verification found: (1) M3's `checkConsistency` and M5's whole-value-snapshot
convention disagreed about what `Delta.kind: "append"` means; (2) the architecture guard policing
"`lib/simulate/**` never reaches an LLM or the network" (and its `domains/**` sibling policing the `await`
ban) had real bypasses. It went through three review rounds before merging — see §3 and §4 for the full
arc, which is a real, substantial part of this project's own verification history, not a footnote. Every
description in this document of what the guard or the append check actually does now describes `main` at
`48fdd8b`, re-verified directly in this session against that commit — not the branch's own body text, and
not an earlier round's since-superseded content.

## 3. What independent verification found, per milestone

Cited to the PR body that reports it — no aggregate "N verification passes" figure is given, because the
unit of record is not consistent across milestones (a PR body's prose vs. an issue-thread comment vs. a
checkpoint's own text), the same caution the stale draft already applied and this one preserves rather than
resolves artificially:

- **M1** (PR #3) — held at not-done despite an initial APPROVE, pending six findings: two HIGH (a `makeWorld`
  the file's own header described but that did not exist yet; an object-literal getter that satisfied
  `isPlainData` with zero casts), one MEDIUM (an unscoped claim about `lib/contracts/**`), two LOW, and one
  ("Finding 4") never described anywhere in the PR body, the commit messages, or the ADR — its content is not
  recoverable from this repository, and this record does not guess at it.
- **M2** (`CURRENT.md`'s historical text, not a PR comment) — five successive rounds against the
  milestone-status drift guard, each round's fix defeated by the next round's exploit, resolved on round five
  by deleting nested-element parsing support outright (a net **88 insertions / 198 deletions**) rather than
  patching a fourth time.
- **M3** (PR #5, then PR #10) — two rounds. Round one found `asProjectedEffect` (a zero-validation cast)
  exported from the public barrel, bypassing all four of `simulate()`'s fail-closed gates, and an import
  allowlist that checked specifier *syntax* rather than resolved *containment* (`../../node_modules/next/...`
  passed). Round two, after the containment fix, found a real symlink inside `lib/simulate/` still defeated
  it, because `path.resolve()` never dereferences symlinks while Node's module resolution does — closed by
  layering a `realpathSync` check on top of the textual one, then stress-tested against six further symlink
  variants (a double chain, a symlinked directory several levels up) before being accepted.
- **M4** (PR #7) — passed, with two findings fixed pre-merge (a forward note on `Reconciliation.drifted`'s
  synthesized `actual` being indistinguishable from a real observation, which M8 later had to render
  correctly on screen; a comment describing a danger the pipeline did not yet have) and one question
  escalated and resolved (whether `Reconciliation`'s single-fact-per-call design loses information — ruled
  accepted-as-documented, a ruling M7/M8 later found a real, live consequence of — see §4).
- **M5** (PR #10) — approved on the first pass. The decisive test built a genuine full-`World` hash collision
  (`{reserved:412789}`/`{reserved:649192}` both → `2ba95242`) and confirmed `runRollback`'s strong check still
  reports `"dishonest"`, because it is `dataMatchesExactly` (`deepEqual`), never fingerprint agreement, that
  drives the branch.
- **M6** (PR #13, marked done two PRs later by #18 — see §4) — approved after reproducing the M3/M5 `append`
  conflict independently rather than trusting the build's own report, stress-testing the `growArraySteps`
  workaround with a second concurrent write onto the same array path (no case in the shipped suite exercises
  this), and confirming a design-doc fingerprint error the build itself had already caught.
- **M7** (PR #11 first, then PR #12, then PR #16/#17) — Cases 2–4 approved in the first pass with one
  follow-up finding (PR #12: Case 4's own claim that `checkConsistency` is immune to the collision "because it
  never reads a fingerprint" was backwards — it is immune *because* it reads one correctly, re-deriving it
  from real data rather than trusting a claimed value). Cases 1 and 5 (PR #16) then found that this project's
  own headline promise (`sim-plan.md` §B) was wrong — see §4.
- **M8** (PR #19) — verified against the live deployed URL, not the merged code, per this milestone's own
  demo command ("the deployed URL runs the §B scenario end-to-end from a click"). Driven with three
  concurrent injected writes rather than the scripted single one, confirming rollback touched only its own
  write while all three concurrent writes survived intact, and confirming zero network requests fire during
  Simulate/Inject/Execute (the engine genuinely runs client-side).
- **PR #15** (append rule + architecture guard, three rounds before merging) — the longest verification arc
  in this repository's history, and the clearest illustration of this project's whole discipline: each round
  found the *previous* round's own header claiming more completeness than the code actually had, and fixed
  both the code and the overclaim. Round 1 fixed the append rule and one guard bypass (a template-literal
  interpolation hiding a call), then a coordinator review found a HIGH-severity bypass of round 1's own fix
  (a regex literal containing a backtick) plus two smaller findings. Round 2 deleted the hand-rolled
  tokenizer for the real TypeScript compiler, fixing the regex-literal bypass and disclosing (not fixing) an
  append-growth gap. Round 3, the one that actually merged, found round 2's real-parser rewrite had moved
  the bug class rather than closed it — a syntax error (an unterminated template literal, a broken function
  signature) made the real parser's own error recovery swallow a real `fetch(...)` call exactly the way the
  old tokenizer did — plus a re-export specifier scan that was never added, plus round 2's append-growth
  disclosure resting on cited evidence that didn't actually hold up when checked against the real code.
  Fixed in round 3: `getSyntacticDiagnostics` runs before any AST walk and fails closed (`UnparseableFileError`
  / `parseOffenders`); re-exports are scanned; the append-growth check is enforced for the one shape the
  evidence actually supports. See §4 item 10 and `docs/ARCHITECTURE.md`'s Stage 2 section for what this means
  is, and is not, guaranteed on `main` today.

## 4. Defects and corrections verification actually caught

Cumulative across the project's whole history, cited to the PR/commit that reports each one:

1. **M1** — `world.ts`'s header described a `makeWorld` that did not exist; the getter-based accessor bypass
   of `isPlainData`; an unscoped "no field may hold a model's prose" claim; a stale checkpoint claiming PR #1
   was still open. (PR #3)
2. **M2** — five drift-guard bypasses, described above. (`CURRENT.md` history, corrected by PR #9)
3. **M3** — `asProjectedEffect`'s barrel-exported bypass; the syntax-vs-containment import-allowlist gap; a
   symlink defeating the containment fix. (PR #5, #10)
4. **M4** — the synthesized-`actual` forward note; an overstated `kind`-matters justification. (PR #6, #7)
5. **M5** — none required a fix; the full-`World` hash collision was the *proof* the milestone was built
   correctly, not a defect in it. (PR #8, #10)
6. **M6** — the genuine M3/M5 `append` disagreement, discovered by building the first real domain that
   appends to an existing array (`ADR 0005 §1`) — reported to the orchestrator rather than silently patched
   into either frozen `lib/**` file, and worked around only inside `domains/**` (`growArraySteps` +
   `netDeltas`). A design-doc fingerprint value (INV-2's `resultingFingerprint`) that could not legitimately
   match INV-1's despite a different timestamp, caught by computing it for real rather than trusting the
   document. (PR #13, confirmed independently by PR #18)
7. **M7** — Case 4's fingerprint-immunity claim had the mechanism backwards for `checkConsistency` (PR #12).
   Cases 1 and 5 found that `sim-plan.md` §B's own headline sentence — "reconciliation names the exact field
   that drifted (`stock.reserved`: predicted 42, observed 45)" — is not what a single, unsliced `reconcile()`
   call actually returns for the real TOCTOU race: it reports `drifted` at `"reservations"` (the frozen
   `Reconciliation` type carries one fact per call, and `"reservations"` sorts first *and* genuinely drifted
   too). `sim-plan.md` §B is now corrected with two appended notes rather than left to quietly pass; the exact
   `stock.reserved: 42 → 45` fact is real and reachable, but only via a second, deliberately path-sliced
   `reconcile()` call, which both `tests/failures/case-1-toctou.test.ts` and the live demo now show
   side-by-side with the unsliced result. (PR #16, #17)
8. **M8** — retired a stale "no working engine exists yet" comment on `app/page.tsx` that had become false;
   confirmed the same `reconcile()` per-path-priority finding independently against a live `npm run dev` run
   before it was reused in M7's own test. (PR #14)
9. **M6, marked done late** (PR #18) — M6 passed independent verification when it merged (PR #13) but its
   `done` status was never flipped in `DONE.html`/`PLAN.md` at the time; corrected two PRs later, with two
   further findings left open rather than fixed inline — see §5.
10. **The architecture guard, resolved on `main` after three rounds** (PR #15) — the M3/M5 `append`
    disagreement (item 6 above) is now actually fixed at its source: `checkConsistency` no longer requires an
    `append`'s current value to be `undefined`, resolving the conflict `domains/**`'s `growArraySteps`
    workaround previously routed around (that workaround is now redundant but still present — see §5, since
    `domains/**` was frozen for this fix too). The guard's tokenizer is gone, replaced with the real
    TypeScript compiler; a regex literal containing a backtick, a syntax error, and an unchecked re-export
    were each found and fixed in turn, each fix's own header overclaiming completeness until the next round
    checked it directly. This is the single clearest example in this repository of the sibling-project
    lesson this milestone was warned about: a header claiming a property is not the same as the property
    holding, and the only way to tell the difference is to check.

## 5. What is genuinely incomplete or open, as of this commit (`main` at `48fdd8b`)

- **The architecture guard's remaining gaps are now real residue on `main`, not an unmerged branch's
  content — and two different claims about it must not be flattened into one.** Verified directly in this
  session against the merged code, not copied from PR #15's own body:
  - *Narrowed, not closed:* the append-growth check (`lib/simulate/consistency.ts`'s `checkAppendGrowth`)
    only enforces a length floor when `delta.before` is a defined array. A same-length-or-longer but
    *unrelated* replacement (`{before: ["a","b"], after: ["x","y","z"]}`) still passes silently, and a
    non-array `append` target is outside the check's scope entirely — both disclosed in the file's own
    header, and both pinned by dedicated regression tests, not merely asserted.
  - *Closed, with one honest, harmless caveat:* the "does this file even parse" gate
    (`getSyntacticDiagnostics`, checked before any AST walk) is not the complete word on ECMAScript
    validity — verified directly with a throwaway script against the real, installed `typescript` package:
    a top-level `return`, a `yield` outside a generator, and a `for await` outside an `async` function each
    produce **zero** syntactic diagnostics (TypeScript classifies them as semantic errors). Checked further:
    in every one of those three shapes the parse tree stays structurally intact and a `fetch(...)` call
    inside it is still found by the AST walk exactly as in valid code — so this caveat does not weaken the
    guard's actual job, but it is a real gap in the narrower claim "this file parses as valid TypeScript,"
    worth stating rather than leaving implicit.
- **Two follow-up findings from PR #18 remain open, exactly as that PR left them, and PR #15 did not touch
  either** (confirmed: `domains/index.ts` and `domains/infra/domain.ts` are absent from `48fdd8b`'s own
  diff stat): infra's own file header and ADR 0005 both claim its distinguishing property is that its
  pipeline "revisits a path more than once within a single action" (`desiredCount`, touched twice) — the
  real distinguishing property, per PR #18's own review, is that the two touches are *non-adjacent* in the
  steps list, not merely repeated; and `domains/index.ts:31`'s comment references
  `domains/__tests__/coverage.test.ts`, which does not exist anywhere in this repository (confirmed directly,
  re-checked after PR #15 merged: `find domains -name '*.test.ts'` still lists only `architecture.test.ts`
  and `fingerprints.test.ts`) — a dead reference, not a missing file anything actually requires to run.
- **The M3/M5 `append` disagreement (ADR 0005 §1) is now resolved at its source, but its `domains/**`-side
  workaround was left in place, unchanged, and is now confirmed-redundant residue.** PR #15's own merge
  commit message says this in so many words: dropping M3's append-must-start-`undefined` rule is "why
  `domains/**`'s `growArraySteps` two-step (remove-then-append) workaround exists — see the PR description
  for whether it is now redundant." Checked directly: `domains/shared/grow.ts` and every `domains/*/domain.ts`
  file are untouched by PR #15's diff (`git show 48fdd8b --stat` lists only `lib/simulate/**`, one
  `lib/rollback/path.ts` comment fix, and both `architecture.test.ts` files) — so `growArraySteps`'s
  remove-then-append pair still runs in every real domain today, satisfying a rule that no longer exists,
  because `domains/**` production code remained frozen for this fix too.
- **`domains/infra/domain.ts`'s re-scoping is honest about what it cannot show:** nothing in the frozen
  `Delta`/`ProjectedEffect`/`Rollback` types carries a cost or duration field, so infra's own
  `monthlyCostUsd`/`provisioningState` bookkeeping is narrative color a human reads, never a value any real
  gate acts on — confirmed directly by reading `domains/infra/domain.ts`'s own header, not merely repeated
  from the design doc's conclusion.

## 6. The checkpoint mechanism has failed twice — the more interesting finding, not just the drift

`.genesis/checkpoints/CURRENT.md` was found stale in this session for the **second time**. The first time
(documented above in §3/§4 under M4/M5, and fixed by PR #9) it sat unchanged for roughly eleven hours across
two merged milestones, still naming M2 as the active loop. This session found it stale again, independently,
before touching it: its text (prior to this PR) still named M3 as the active loop on branch `m3-simulate`
(PR #5), stated "M6, M7 and M8 are designed but unbuilt," and reported `main` at "14 test files / 147
tests" — all three false against the real tip at the time (M6, M7, and M8 already merged and marked done;
29 files / 293 tests, later 337 after PR #15). `.genesis/DONE.html` and `app/milestones.ts` did **not** have
this problem either time — both were current and agreed with each other (§1) — so the drift is specific to
this one file's mechanism, not the project's actual status record.

**The repeat is the finding, not the staleness itself.** PR #9 didn't just fix the file — it wrote, in the
file itself, "a checkpoint that lags the repo is worse than no checkpoint: it is a stated claim that happens
to be false." That sentence survived, unedited, in the very file that then went on to lag the repo a second
time, for the same reason the first time: nothing in this project's process requires `CURRENT.md` to be
touched by a milestone that doesn't otherwise need to edit it, so a milestone that ships without a
checkpoint update leaves the file describing whichever milestone last remembered to write one. Writing a
correct diagnosis into a document does not make the document self-enforcing — this is now demonstrated
twice, not argued once. `.genesis/**` is outside this milestone's own freeze boundary (`docs/**` and
`README.md` only), so `CURRENT.md` is corrected as part of this PR (see the top-level commit that does it)
rather than merely reported here — but the fix is the file's content, not the mechanism that let it drift;
nothing in this PR adds a structural guard against a third occurrence, and that absence is itself worth
naming rather than implying the correction solves the recurring problem.

## 7. On the two attribution caveats

Every commit in this repository ends with the same `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` /
`🤖 Generated with Claude Code` trailer (or the equivalent for whichever model's harness wrote a given
commit) — confirmed by inspection of the commit messages quoted throughout this record. **That trailer is a
fixed string the orchestrating harness writes on every commit regardless of which model actually did the
work; it is not evidence of authorship, and no claim in this record treats it as such.**

Separately: `.genesis/checkpoints/CURRENT.md` has never contained a `model:` field in any revision —
verified directly in this session with `git log --all -p -- .genesis/checkpoints/CURRENT.md`, not merely
carried over from the stale draft's earlier check: every match for the string `model:` across the file's
entire history is prose *describing* that absence, never an actual field. There is no self-reported
per-build-loop model record in this repository to rely on or to caveat, and this record does not infer one
from commit content, timing, or writing style.
