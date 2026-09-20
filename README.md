# shadow-run

**Simulate before you act.** An agent projects the effects of a write before executing it — a typed diff
against a cloned snapshot, never a sentence — with a rollback path computed in front of every write. The
projection is checked against what actually happened (reconciliation), and a run of consecutive
non-confirmed reconciliations is counted by a trust feedback loop that computes exactly when a domain
*should* require a pre-validated rollback.

**That counter is a dashboard today, not a gate — stated plainly, not softened.** `updateTrust` runs on
every real execution and the live demo displays the number, but no caller anywhere in this repository — no
domain, no script, no page — reads `requiresPreValidatedRollback`'s answer before deciding whether to run a
rollback. `tests/failures/case-5-gate-never-consulted.test.ts` proves it: the gate flips to `true` for real,
and the ordinary call shape every domain uses proceeds to another real execution anyway. This is the exact
risk the project's own plan named at the outset — divergence detected and counted, with no consequence —
currently true of the shipped system, not merely a hypothetical the plan warned about. See
`docs/ARCHITECTURE.md`'s Reconciliation section for the full account.

No credentials, API keys, or secrets are needed to run this anywhere — locally or deployed. Every domain in
this repository is self-contained, in-memory, and synthetic; `lib/simulate/**` is architecturally
guaranteed (a grep-based test, not a promise) to never reach an LLM, the network, or a Node built-in.

**Live:** https://shadow-run-three.vercel.app — `/api/health` reports the deployed commit SHA.

## What's here

- `lib/contracts/**` — the four frozen types every later stage imports and none redefines: `World`,
  `ProjectedEffect`, `Reconciliation`, `Rollback`.
- `lib/simulate/**` — shadow execution: `simulate(action, world, adapter)`, run against a cloned, frozen
  `World`, through four fail-closed gates.
- `lib/reconcile/**` — the mechanical predicted-vs-observed diff (`reconcile()`) and the reset-on-success
  trust counter (`updateTrust`/`requiresPreValidatedRollback`).
- `lib/rollback/**` — the engine that actually runs a `Rollback`'s recorded `steps` and decides what
  happened: `restored`, `failed`, `dishonest`, or `unavailable` — never a bare boolean.
- `domains/**` — four real adapters (calendar, inventory, notification, infra) wired end to end:
  `simulate → execute → reconcile → rollback`.
- `tests/failures/**` — five deliberate failure cases, including the project's own headline TOCTOU scenario
  and a real hash collision in this codebase's own inventory field.
- `app/`, `components/` — the live, interactive demo (`InventoryDemo`), driving the real engine client-side.
- `docs/ARCHITECTURE.md` — stage by stage, what each layer refuses to do and why, cited to real tests.
- `docs/THESIS.md` — the two-year bet this project is making.
- `docs/WALKTHROUGH.md` — the 90-second demo script, timed against a live run.
- `docs/NOTES.md` — the process record: every PR, every independent-verification finding, reconstructed from
  `git log`/`gh pr`, not narrated from memory.

## Run it locally

Requires Node v24.x. No environment variables to set — see `.env.example`.

```sh
npm ci          # never `npm install` after the lockfile exists
npm run dev     # http://localhost:3000 — the interactive demo
```

## Verify

```sh
npm run typecheck   # tsc -p tsconfig.lib.json && tsc -p tsconfig.json, both clean
npm test            # vitest run -- 29 files / 337 tests
npm run build       # next build --webpack
npm run demo:domains  # all seven domain cases, end to end, against the real engine
```

`npm run demo:domains` prints every case's projected effect, observed effect, `Reconciliation` status, and
`Rollback` outcome, and exits non-zero unless all three `Reconciliation` statuses and both `Rollback` kinds
are actually observed in that run — a demo that narrates coverage it didn't produce is worse than one that
admits it fell short.

## The clean-clone demo command

This is the exact command a judge or reviewer would run, and the one this milestone's own plan names:

```sh
cd "$(mktemp -d)" && git clone https://github.com/vladimir-mawla/shadow-run . && npm ci && npm run typecheck && npm test
```

It clones `main` — which is 8 of 9 milestones (M9, this one, isn't on `main` yet) — installs with zero
credentials configured, typechecks clean, and runs **29 test files / 337 tests, all passing**. Run for real
against a fresh temp directory while writing this document, not assumed.

## Check the live deployment

```sh
curl -sf https://shadow-run-three.vercel.app/api/health
```

Returns HTTP 200 with the deployed commit SHA and a live self-check of `lib/contracts` (fingerprint key-order
independence, and that a function-bearing value is actually rejected at runtime) — confirmed matching
`main`'s current tip when this README was written.

## The one line worth knowing before you look at the numbers

`reconcile()` reports exactly one fact per call — the frozen `Reconciliation` type has room for one
`expected`/`actual` pair, never a list. The project's own original headline promise (a single call would
name `stock.reserved: predicted 42, observed 45`) turned out to be wrong once a real, multi-field race was
built and run: the unsliced call reports `"reservations"` drifted first, because that path sorts first *and*
genuinely drifted too. Both readings are real, and both are shown side by side in the live demo and in
`tests/failures/case-1-toctou.test.ts` — see `docs/ARCHITECTURE.md`'s Reconciliation section and
`docs/NOTES.md` §4 for the full account of finding this and correcting it rather than quietly shipping past
it.
