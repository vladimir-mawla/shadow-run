# CURRENT

- **active_loop:** M9 (`docs/**`, `README.md`) — deliverables, in progress on branch `m9-deliverables` (PR
  #20). M1 through M8 are all merged and marked done; M9 is the only milestone left.

- **last updated:** 2026-09-20, after PR #15 (the M3-append-rule / architecture-guard fix) merged as
  `48fdd8b`, and after this file was found stale a **second time** while M9 was being built — see
  `docs/NOTES.md` §6 for the full finding, which is worth more than this correction on its own. The previous
  revision of this file (in place from shortly after M4/M5 merged until this correction) still named M3 as
  the active loop on branch `m3-simulate` (PR #5) and described M6/M7/M8 as "designed but unbuilt," even
  though all three had merged and been marked done hours earlier. That is the identical failure mode this
  file's own PREVIOUS correction (recorded below) already named once: **a checkpoint that lags the repo is
  worse than no checkpoint, because it is a stated claim that happens to be false — and writing that sentence
  into this file the first time did not stop it from becoming true again.** Nothing about how this file gets
  updated changed between the two staleness episodes; only the content did. A future milestone that touches
  `lib/**`, `domains/**`, or `app/**` without also touching this file will very likely reproduce it a third
  time, and that risk is named here rather than assumed solved by this edit.

## Milestone state, as of this revision

| | Status | Where |
|---|---|---|
| M1 contracts | **done** | `main`; built directly on `main` through a repo-setup error since cleaned up, fixes on `m1-fixes` (#3, merged) |
| M2 deploy | **done** | `main` (#2, #4 merged). Live at `https://shadow-run-three.vercel.app` — `/api/health` returns 200 with the deployed SHA |
| M3 simulate | **done** | `main` (#5, #10 merged) |
| M4 reconcile | **done** | `main` (#6, #7 merged) |
| M5 rollback | **done** | `main` (#8, #10 merged) |
| M6 domains | **done** | `main` (#13 merged, #18 marked done after being missed at merge time) |
| M7 failure suite | **done** | `main` (#11, #12, #16, #17 merged) |
| M8 demo | **done** | `main` (#14, #19 merged, verified against the live deployed URL) |
| M9 deliverables | `todo` | in progress, `m9-deliverables` (PR #20) |

`main` carries **29 test files / 337 tests** (`npm test`, re-verified directly against `origin/main` at
`48fdd8b` while writing this correction — not carried over from an earlier count).

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
- **M6** — approved after reproducing the M3/M5 `append` conflict from scratch rather than trusting the
  build's own report, and stress-testing the `growArraySteps` workaround with a second concurrent write onto
  the same array path (no shipped case exercises this). Confirmed the build's own catch that the design
  doc's INV-2 fingerprint reused INV-1's value despite a different timestamp. Two findings left open rather
  than fixed inline (infra's "repeated path" claim should say "non-adjacent"; `domains/index.ts` references
  a `coverage.test.ts` that does not exist) — both still open as of M9.
- **M7** — Cases 2-4 approved with one follow-up (Case 4's `checkConsistency`-immunity claim had the
  mechanism backwards: it is immune *because* it reads a fingerprint correctly, not because it never reads
  one). Cases 1 and 5 then found this project's own headline promise (`sim-plan.md` §B) was wrong: the real
  TOCTOU race's unsliced `reconcile()` call reports `drifted` at `"reservations"`, not `"stock.reserved"` —
  corrected in §B with two appended notes rather than quietly left inconsistent with the shipped demo.
- **M8** — verified against the *live deployed URL*, not the merged code, per its own demo command. Driven
  with three concurrent injected writes rather than the scripted single one; confirmed rollback touched only
  its own write while all three concurrent writes survived, and confirmed zero network requests fire during
  Simulate/Inject/Execute.
- **The architecture guard (PR #15) — three rounds, the longest verification arc in this repository.** Round
  1 fixed the append rule and a template-interpolation bypass; a coordinator review then found round 1's own
  fix had a HIGH-severity bypass (a regex literal containing a backtick blinding the scanner to the rest of
  the file). Round 2 deleted the hand-rolled tokenizer for the real TypeScript compiler — closing that
  bypass, but a further review found round 2's rewrite had moved the bug class rather than closed it: a
  syntax error made the real parser's own error-recovery swallow a real `fetch(...)` call the same way the
  old tokenizer did, and re-exports were never scanned at all. Round 3 (merged as `48fdd8b`) added a
  syntactic-diagnostics fail-closed gate and re-export scanning, and narrowed the append-growth disclosure to
  what its cited evidence actually supports. Each round's own header claimed more completeness than the code
  actually had, until the next round checked it directly — see `docs/NOTES.md` §3/§4 for the full account.

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
