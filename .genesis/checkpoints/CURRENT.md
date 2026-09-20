# CURRENT

- **active_loop:** M3 (`lib/simulate/**`) in final independent verification on branch `m3-simulate` (PR #5).
  M6, M7 and M8 are designed but unbuilt — they depend on M3 landing.

- **last updated:** 2026-09-20, after M4 and M5 merged. The previous revision of this file described M2 as
  the active loop with PR #2 open, and stood unchanged for roughly eleven hours across two merged
  milestones. That staleness was found by reconstructing this project's own history from `git log` and PR
  comments rather than from this file — worth recording, because a checkpoint that lags the repo is worse
  than no checkpoint: it is a stated claim that happens to be false.

## Milestone state, as of this revision

| | Status | Where |
|---|---|---|
| M1 contracts | **done** | `main`; built directly on `main` through a repo-setup error since cleaned up, fixes on `m1-fixes` (#3, merged) |
| M2 deploy | **done** | `main` (#2, #4 merged). Live at `https://shadow-run-three.vercel.app` — `/api/health` returns 200 with the deployed SHA |
| M3 simulate | `todo` | `m3-simulate` (#5), open. Built, rejected once, six findings fixed, final verification running |
| M4 reconcile | **done** | `main` (#6, #7 merged) |
| M5 rollback | **done** | `main` (#8 merged) |
| M6 domains | `todo` | designed only — `scratchpad/m6-domain-cases.md`, no branch, no code |
| M7 failure suite | `todo` | designed only — `scratchpad/m7-failure-suite.md` |
| M8 demo | `todo` | designed only — `scratchpad/m8-demo-design.md` |
| M9 deliverables | `todo` | thesis and process record drafted; architecture snapshot and README deliberately not drafted, since their content is "what was actually built and verified" |

`main` carries `lib/contracts`, `lib/reconcile`, `lib/rollback` at **14 test files / 147 tests**.

## What independent verification has actually caught

Recorded because it is the substance of this project's discipline, and because reconstructing it later
proved unreliable on the sibling project.

- **M1** — `world.ts` documented `assertPlainData` as running "at every construction boundary... (`makeWorld`
  below)" when no `makeWorld` existed anywhere; and an ordinary getter (`{ get x() { return n++; } }`)
  satisfied `Json`, passed `isPlainData`, and returned a different value on every read, defeating the file's
  own "same input, same fingerprint" premise with no cast involved. A later round found `makeWorld` neither
  cloned nor froze its input, so a caller holding a reference could silently invalidate the fingerprint it
  had just computed.
- **M2** — five rounds against the drift guard in `app/milestones.test.ts`, each a real bypass: the first
  `pill`-classed span in a row winning over the row's actual status pill; then the first match *within* the
  last cell; then a tag-strip that let a nested `<b>done</b>` be read as the status of a `todo` pill; then a
  tag scanner fooled by a `>` inside a quoted attribute. Resolved by deleting the nested-element support
  entirely — a net **88 insertions / 198 deletions** — rather than adding a fifth layer of parsing.
- **M3** — one formal rejection. `asProjectedEffect`, a bare zero-validation cast, was exported from the
  public barrel, letting any caller bypass all four of `simulate()`'s fail-closed gates. The import
  allowlist checked that a specifier *looked* relative rather than that it *resolved* inside the boundary,
  so `../../node_modules/next/package.json` passed and was confirmed to resolve to a real directory. A
  follow-up round found a real symlink inside `lib/simulate/` still defeated the fixed check, because
  `path.resolve()` never dereferences symlinks while Node's module resolution does.
- **M4** — a forward note was missing for M6/M8: `drifted.actual` may be *synthesized* rather than observed
  and is structurally indistinguishable from a real one, while M8 renders it for a judge. Separately, a
  comment described a danger the current pipeline does not have.
- **M5** — approved. The decisive test built a genuine full-`World` collision (`{reserved:412789}` and
  `{reserved:649192}` both hash to `2ba95242`) and confirmed `runRollback` still returns `"dishonest"`,
  because deep-equality is what the pass/fail branch keys on. The disclosed weakness — a fabricated step
  that applies cleanly but writes the wrong value is reported as `"restored"` on the default path — was
  reproduced, judged a correct trade, and turned into a stated requirement on M6 in ADR 0004.

## Known gaps in this repository's own record

- `gh pr view N --json reviews` is empty for every PR: GitHub's formal review feature was never used.
  Verification reports are posted as PR **comments**, and M4's and M5's were posted only retroactively —
  after their merges — because the reports existed in the orchestration but had not been written anywhere
  the repository could show.
- "Finding 4" of M1's verification is absent. The fix list on PR #3 runs 1, 2, 3, 5, 6, and the gap is
  real: finding 4 was a low-severity freeze-boundary precision note — that `next.config.ts`, `package.json`
  and `app/**` already existed as of M1's commit sequence although `PLAN.md` assigns them to M2 — judged
  well-founded bootstrapping (Next's own tsconfig fails with zero files under `app/`) and deliberately not
  fixed. That decision was never recorded, which is why it reads as a gap.
- This file has never contained a `model:` field in any revision, so which model built which milestone is
  not recoverable from the repository at all. Note that the `Co-Authored-By` trailer on every commit is a
  fixed string written by the orchestrating harness regardless of which model did the work — it is not
  evidence of authorship and must not be read as such.
