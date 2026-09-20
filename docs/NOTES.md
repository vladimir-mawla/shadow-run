# shadow-run — process record

Reconstructed from primary sources only: `git log --oneline --all`, `gh pr list --state all`, `gh pr view N
--json body,comments` and `gh api repos/.../pulls/N/reviews` for every PR (1 through 19), the six ADRs under
`.genesis/decisions/`, `.genesis/DONE.html`, `app/milestones.ts`, and `.genesis/checkpoints/CURRENT.md` —
read from the `m9-deliverables` worktree, branched from `origin/main` at `fedde88` (M8 marked done), on
2026-09-20. A stale scratchpad draft of this file exists from before M6, M7, and M8 merged; it is not used as
a source for any number below — every count here was re-run against this repository directly, not carried
over. Two of this session's own counts were independently corrected mid-task by re-measuring rather than
trusting the first pass (see §5); none of the numbers below are a first-pass, unchecked figure.

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

`main` (`origin/main`, `fedde88`) carries **29 test files / 293 tests**, confirmed by running `npm test`
directly in this worktree and again against a fresh clone of `origin/main` in a scratch directory (see the
top-level report for the clean-clone transcript). Live at `https://shadow-run-three.vercel.app`.

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
| 15 | Fix M3 append rule + tokenizer bypass | `fix-m3-append-and-tokenizer` → `main` | **OPEN** | — | 0 |
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

**PR #15 is open, not merged, as of this repository's current tip.** It authorizes a deliberate reopening of
frozen `lib/simulate/**` and `domains/**` to fix two things independent verification found: (1) M3's
`checkConsistency` and M5's whole-value-snapshot convention disagree about what `Delta.kind: "append"`
means (the same conflict `domains/**` already works around — see §4 and §5); (2) the architecture guard that
polices "`lib/simulate/**` never reaches an LLM or the network" had a real bypass via a regex literal
containing a backtick. Its own latest revision deletes the hand-rolled tokenizer entirely and re-parses every
scanned file with the real TypeScript compiler. **This PR is not merged on this branch's base, and this
milestone's own instructions require describing what is true at this commit, not what a pending PR
proposes** — see §5 for what independent verification in this session found is still true even at PR #15's
latest revision.

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

## 5. What is genuinely incomplete or open, as of this commit

- **PR #15 is open, not merged, and this session independently re-verified rather than assumed what its own
  latest revision still leaves uncaught.** Its architecture-guard rewrite replaces a hand-rolled tokenizer
  with the real TypeScript compiler and closes the specific bypass (a regex literal containing a backtick)
  that motivated the rewrite. Checked directly in this session, against that branch's own
  `lib/simulate/__tests__/architecture.test.ts` code, with a throwaway script reproducing its exact
  `analyzeFile` logic: an **unterminated template literal** — a syntax error, not valid-but-tricky syntax —
  still lets a plain, unobfuscated `fetch(...)` call on the next line through completely undetected
  (`bareFetchCalls: []`), because TypeScript's fault-tolerant parser still returns a `SourceFile` for
  malformed input, but the broken template consumes the rest of the file as string content before the real
  call is ever reached as a `CallExpression` node. This is the same *class* of bypass the regex-literal fix
  just closed — a lexical construct earlier in the file hides a call later in the file — reopened by a
  different lexical construct. PR #15's own "still not caught" list names only *semantic* gaps (`globalThis
  ["fetch"]`, an alias, `.then()` instead of `await`); this is a *lexical* one its own header does not
  mention. Not fixed anywhere on `main` or on PR #15 as of this commit.
- **Two follow-up findings from PR #18 remain open, exactly as that PR left them:** infra's own file header
  and ADR 0005 both claim its distinguishing property is that its pipeline "revisits a path more than once
  within a single action" (`desiredCount`, touched twice) — the real distinguishing property, per PR #18's
  own review, is that the two touches are *non-adjacent* in the steps list, not merely repeated; and
  `domains/index.ts:31`'s comment references `domains/__tests__/coverage.test.ts`, which does not exist
  anywhere in this repository (confirmed directly: `find domains -name '*.test.ts'` lists only
  `architecture.test.ts` and `fingerprints.test.ts`) — a dead reference, not a missing file that was ever
  actually required by anything that runs.
- **`.genesis/checkpoints/CURRENT.md` is stale a second time — the exact failure mode PR #9 already fixed
  once.** Its current text still names M3 as the active loop on branch `m3-simulate` (PR #5), states "M6, M7
  and M8 are designed but unbuilt," and reports `main` at "14 test files / 147 tests." All three are false
  against `main`'s real tip (`fedde88`; M6, M7, and M8 all merged and marked done; 29 files / 293 tests, both
  reproduced directly in this session). `.genesis/DONE.html` and `app/milestones.ts` do **not** have this
  problem — both are current and agree with each other (§1) — so the drift is confined to this one file, not
  the project's actual status record. This is named here rather than silently corrected, per this document's
  own scope (a process record, not a code fix), and because the pattern repeating once already is itself the
  finding worth keeping.
- **The M3/M5 `append` disagreement (ADR 0005 §1) is real and still unresolved on `main`.** It is worked
  around entirely inside `domains/**` (`growArraySteps`, `netDeltas`) because neither frozen `lib/**` file was
  this milestone's to edit; the actual fix (dropping M3's append-must-start-undefined rule, confirmed as the
  outlier against ADR 0004's later, whole-value-snapshot convention) exists only on the still-open PR #15.
- **`domains/infra/domain.ts`'s re-scoping is honest about what it cannot show:** nothing in the frozen
  `Delta`/`ProjectedEffect`/`Rollback` types carries a cost or duration field, so infra's own
  `monthlyCostUsd`/`provisioningState` bookkeeping is narrative color a human reads, never a value any real
  gate acts on — confirmed directly by reading `domains/infra/domain.ts`'s own header, not merely repeated
  from the design doc's conclusion.

## 6. On the two attribution caveats

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
