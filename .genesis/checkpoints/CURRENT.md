# CURRENT
- active_loop: M2 (deploy a live skeleton to Vercel — the second milestone on `.genesis/PLAN.md`), branch
  `m2-deploy`, opened against `main`. M1's commits (`lib/contracts/**`, ADR 0001) landed directly on `main`
  through a repo-setup error that has since been cleaned up — normal branch/PR flow resumes with this
  milestone. M1 passed independent (L4) verification; its fixes (`makeWorld`, `deepFreezeClone`, accessor
  rejection, scoped claims — see `m1-fixes`, PR #3) merged to `main` and are now folded into `m2-deploy` via
  `git merge main`. M1 is marked `done` in `.genesis/DONE.html` and `app/milestones.ts` as of this session.
  This M2 session addressed independent-verification findings against the M2 work itself, across five
  rounds (each later round attacked the previous round's own fix rather than taking it on faith): (1) the
  drift guard's regex matched the first pill-ish span anywhere in a row instead of the real status pill —
  fixed to anchor on the row's last `<td>` and match the `pill` class as an exact token, not a prefix; (2)
  that first fix still used a non-`g` `.match()` inside the last cell, so a SECOND exact-token pill span in
  that cell would still win by appearing first — fixed by requiring the cell's entire trimmed content to be
  exactly one pill element (`^`/`$`-anchored); (3) a stale comment on `app/api/health/route.ts`'s
  `runtime = "nodejs"` declaration claimed it guarded against "an accident of a default that could change,"
  which no longer holds on Next.js 16.3+ (`edge` is deprecated, Node.js is the unconditional default) —
  comment corrected, declaration kept as explicit documentation; (4) `app/page.tsx`'s header comment stated
  a specific done-count ("as of M2, zero milestones are marked done") that went stale the moment M1 was
  marked done — replaced with prose describing that the count is computed, not asserting a number that can
  drift again; (5) round 3 found the round-2 fix had overshot into rejecting ordinary, zero-risk edits — a
  status word with a hyphen or digit (`"in-progress"`, `"wip2"`), an extra cosmetic class token
  (`"pill ok extra"`), and a purely decorative nested icon span inside the pill all threw. Fixed (at the
  time) by widening the status-text pattern, allowing further class tokens after `pill`, and tolerating a
  nested element that carried no text of its own; (6) round 4 found that tolerating nested elements at all
  had reopened a real bypass one level deeper — `<span class="pill todo"><b>done</b></span>` read as
  "done" with no fake pill needed. Fixed (at the time) with a second, generic-tag depth walk requiring
  nested elements to carry zero text; (7) round 5 found THAT fix had its own hole, through attribute
  quoting: `<span class="pill todo"><i data-x="a/>done</i></span>` read as "done", because the depth
  walk's tag-matching regex had no concept of a quoted attribute containing `>`. At this point the
  decorative-icon case that started rounds 5–7's whole line of machinery was recognized as something
  nobody had actually asked for — a speculative future convenience that had cost three straight rounds of
  bypasses. So round 5's real fix REMOVED nested-element support entirely (deleting the generic tag-depth
  walker, the `<span>`-specific one, and all self-closing detection) rather than patching it a fourth time:
  the status cell must now match one single anchored shape,
  `<span class="pill TOKENS">TEXT</span>` with no nested elements, comments, or extra attributes of any
  kind, full stop. The three calibration wins that never needed nesting — hyphens/digits in the status
  text, extra class tokens after `pill`, and whitespace padding around the cell — are kept. The diff for
  this round was substantially negative (removed far more parsing machinery than it added).
  `parsePillCellText`'s own comment records, explicitly, why nested-element support is gone: three
  demonstrated bypasses (the fake nested pill, `<b>done</b>`, and the attribute-quoting case), so anyone
  who later needs a decorative child must change this pattern deliberately, with tests for all three,
  rather than relaxing it because it looks over-tight.
- target: `app/api/health/**`, `vercel.json` (not added — see below), `next.config.*`, `package.json` only.
  No `lib/**` change of any kind — `lib/contracts/**` stays frozen from M1. No simulate/reconcile/rollback
  engine, no domains, no interactive demo (M3–M8).
- what actually shipped: `app/api/health/route.ts` (HTTP 200/503, JSON body naming
  `VERCEL_GIT_COMMIT_SHA` or an honest `"unknown (local dev)"` fallback, plus a real runtime check against
  M1's `computeFingerprint`/`assertPlainData` — not a bare liveness ping); `app/milestones.ts` +
  `app/milestones.test.ts` (the done-claim drift-guard mechanism, copied from decision-engine, checked
  against `.genesis/DONE.html`'s own status table); `app/page.tsx` rewritten to read progress from that
  module and state plainly that no simulator/reconciliation/rollback engine exists yet;
  `next.config.ts`'s pre-existing worked-example comment corrected to reference this repo's own
  verification instead of decision-engine's cost-model wording it had been carrying verbatim.
  `.genesis/DONE.html`'s M2 row got one explicit note (no pill flipped) that no deployment exists yet.
  No `vercel.json` — Next.js's zero-config detection is sufficient (matching decision-engine, which also
  has none), so an empty placeholder file was deliberately not added. No new dependency in `package.json`.
- verified, not merely claimed: `npm ci` clean (rolldown native binding survives). `npm run typecheck`
  exits 0 on both tsconfigs. `npm test` runs 8 test files, 83 tests, all passing — measured fresh after the
  `main` merge and all five verification-fix rounds, not assumed: `main`'s 7 files/59 tests, plus
  `app/milestones.test.ts` alone now carrying 24 tests (the original 2; the decoy-row and no-pill-at-all
  tests from round 1; round 2's attack suite — two-pills-both-orders, pill-plus-text both directions,
  whitespace-only, empty cell, whitespace-padding-is-fine; round 3's still-rejected set — unclosed span,
  self-closing pill span, duplicated identical pill, uppercase status text — plus its still-kept
  calibration wins — hyphenated status, digit in status, extra class token; round 5's must-throw set for
  nested elements of any kind — the three demonstrated bypasses by name, an empty nested element, and a
  nested comment — plus an extra-attribute-on-the-pill-span case. The round-3/4 tests that asserted a
  nested element could be ACCEPTED were deleted rather than left asserting removed behaviour.) `npm run
  build` (`next build --webpack`) succeeds; the build's route summary shows `/api/health` as `ƒ`
  (dynamic), not statically prerendered.
  `npm run dev` + `curl -s -i http://localhost:3000/api/health` returned a real `200` with
  `"commit":"unknown (local dev)"` when `VERCEL_GIT_COMMIT_SHA` was unset, and the real HEAD SHA verbatim
  when it was set for the same run — both paths actually exercised, not assumed from reading the code.
  `git diff main -- lib` is empty.
- not done, and cannot be marked done from here: the actual Vercel deployment is a human step (account
  import) this agent cannot perform and did not attempt — no signup, no guessed URL. The repo is
  import-ready; the PR names the exact human steps and the command to confirm the deploy afterwards. M2
  stays `todo` in both `.genesis/DONE.html` and `app/milestones.ts` until a real `$DEPLOY_URL` answers
  `curl -sf $DEPLOY_URL/api/health` — it is not flipped just because the code is ready. The PR (#2) is
  open, not merged.
- PR history: M1's real history lives directly on `main` (see the now-superseded `m1-contracts-final`/#1,
  closed) plus its independent-verification fixes on `m1-fixes`/#3 (merged to `main`). M2's work is on
  `m2-deploy`/#2, open against `main`, not merged.
