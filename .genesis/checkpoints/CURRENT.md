# CURRENT
- active_loop: M2 (deploy a live skeleton to Vercel — the second milestone on `.genesis/PLAN.md`), branch
  `m2-deploy`, opened against `main`. M1's commits (`lib/contracts/**`, ADR 0001) landed directly on `main`
  through a repo-setup error that has since been cleaned up — normal branch/PR flow resumes with this
  milestone. M1 is content-complete (frozen, `npm test -- contracts` green) but still awaiting independent
  (L4) verification, so it is NOT marked `done` in `.genesis/DONE.html` yet; this milestone does not touch
  it further.
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
  exits 0 on both tsconfigs. `npm test` runs 8 test files, 44 tests, all passing (the prior 7 files/42
  tests from M1, plus `app/milestones.test.ts`'s 1 file/2 tests). `npm run build` (`next build --webpack`)
  succeeds; the build's route summary shows `/api/health` as `ƒ` (dynamic), not statically prerendered.
  `npm run dev` + `curl -s -i http://localhost:3000/api/health` returned a real `200` with
  `"commit":"unknown (local dev)"` when `VERCEL_GIT_COMMIT_SHA` was unset, and the real HEAD SHA verbatim
  when it was set for the same run — both paths actually exercised, not assumed from reading the code.
  `git diff main -- lib` is empty.
- not done, and cannot be marked done from here: the actual Vercel deployment is a human step (account
  import) this agent cannot perform and did not attempt — no signup, no guessed URL. The repo is
  import-ready; the PR names the exact human steps and the command to confirm the deploy afterwards. M2
  stays `todo` in `DONE.html` until a real `$DEPLOY_URL` answers `curl -sf $DEPLOY_URL/api/health`. The PR
  is open, not merged.
