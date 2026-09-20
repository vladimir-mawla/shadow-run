import type { Action } from "../lib/simulate/index.js";
import type { Delta, Json, ProjectedEffect, Rollback, World } from "../lib/contracts/index.js";

/**
 * `domains/**` (M6) — the freeze boundary this file lives inside, per
 * `.genesis/PLAN.md`'s M6 row. Everything under `lib/**` (contracts,
 * simulate, reconcile, rollback) is frozen and imported, never redefined
 * here. This file fixes the ONE shape every domain in this milestone
 * implements against, so `scripts/demo-domains.ts` (the M6 "wiring," per
 * the design doc's own closing section) can drive all four domains
 * identically without a `switch` on which domain it happens to be running.
 *
 * See `.genesis/decisions/0005-domains.md` for the full argument behind
 * every choice below — this header states the choices, not the case for
 * them, to avoid duplicating that document.
 */

/**
 * What a domain's real execution actually returns. Deliberately WIDER
 * than the design doc's own summary line ("`applyReal(action, world):
 * World` — real mutation, same shape"): `lib/contracts/**` never fixes
 * `applyReal`'s signature at all (it is not one of the four irreducible
 * types, and not even a name `lib/simulate`/`lib/reconcile`/`lib/rollback`
 * use) — it is an M6-invented function, so choosing its exact shape is
 * this milestone's call, not a frozen-boundary violation.
 *
 * `observedDeltas` is carried back alongside `world` because ADR 0004's
 * forward note to M6 is explicit and non-optional: "domains constructing
 * a `Rollback.runnable` must retain `observedDeltas` alongside the
 * derived `steps` in whatever record they keep; `Rollback`'s frozen shape
 * does not carry them, so M5 cannot enforce this and M6 must do it by
 * discipline." Returning it here, rather than recomputing it later from a
 * generic before/after diff, is also what keeps "this action's own
 * effect" and "what actually got applied" a SINGLE source of truth (the
 * same `Delta[]` is handed to `applyDeltas` for the real write AND kept
 * for `proposeRollback` to invert) instead of two independently-computed
 * values that could silently drift apart.
 */
export interface AppliedReal<TState extends Json> {
  readonly world: World<TState>;
  readonly observedDeltas: ReadonlyArray<Delta>;
}

/**
 * The one thing every M6 domain contributes — never reconciliation logic,
 * never a read of `SimulatorTrust`, per the milestone brief's own
 * constraint ("domains contribute data, never outcome logic"). `project`
 * is typed identically to `lib/simulate`'s own `SimulationAdapter.project`
 * (same parameter/return shape) so a `DomainAdapter` can be handed
 * straight to `simulate()` without an adapter-of-an-adapter shim.
 *
 * `proposeRollback` takes `worldBeforeThisWrite` (not just
 * `observedDeltas`) because `Rollback.runnable.projectedRestoration
 * .resultingFingerprint` must equal that World's `fingerprint` for
 * `runRollback`'s cheap self-consistency check (ADR 0004, Decision 7) to
 * pass — a domain that built `projectedRestoration` from anything else
 * would fail that check by construction, every time.
 */
export interface DomainAdapter<TState extends Json> {
  readonly project: (action: Action, world: World<TState>) => ProjectedEffect;
  readonly applyReal: (action: Action, world: World<TState>) => AppliedReal<TState>;
  readonly proposeRollback: (
    observedDeltas: ReadonlyArray<Delta>,
    worldBeforeThisWrite: World<TState>,
  ) => Rollback;
}

/**
 * What the demo script's wiring decided to DO with a case's `Rollback`,
 * kept as data on the case itself (never as logic inside a domain module,
 * per the "domains never own... whether a runnable rollback actually gets
 * executed" instruction in `.genesis/PLAN.md`'s M6 summary) so the policy
 * is visible and auditable in one place per case, not buried in an
 * `if`/`else` inside `scripts/demo-domains.ts`.
 *
 *   - "unused"       — reconciliation confirmed; a runnable rollback is
 *                        proposed (computing it costs nothing) but the
 *                        pipeline never calls `applyDeltas` against it.
 *   - "execute"       — reconciliation drifted; the rollback is actually
 *                        run. Always paired with `rollbackHonestyCheck`
 *                        below naming WHICH of ADR 0004's two required
 *                        honesty checks applies.
 *   - "propose-only"  — reconciliation unprojected; a runnable rollback
 *                        is proposed and printed, but whether to actually
 *                        run it is a trust-gate/escalation decision this
 *                        demo deliberately does not make (see
 *                        `.genesis/decisions/0005-domains.md` — the
 *                        design doc's own words: "a trust-gate decision
 *                        this domain does not make").
 *   - "not-applicable" — the rollback itself is `unavailable`; there is
 *                        nothing to execute or not execute.
 */
export type RollbackPolicy = "unused" | "execute" | "propose-only" | "not-applicable";

/**
 * A `DomainCase` is realistic synthetic data — a starting `World`, an
 * `Action`, and (where the case calls for it) a real, injected concurrent
 * write — never a domain's own verdict about what SHOULD happen. Every
 * `expected*` field below is this case's OWN claim, checked by the demo
 * script against what the real engine actually returns, exactly the same
 * "asserted, not just narrated" discipline decision-engine's own
 * `DomainCase.expected` uses (`lib/domains/types.ts`, that project).
 *
 * TWO KINDS OF INJECTED INTERFERENCE, KEPT DELIBERATELY DISTINCT — see
 * ADR 0005 for the fuller argument:
 *
 *   - `injectConcurrentWrite` — a second, REAL write to the SAME
 *      `World.id`, landing between `simulate()` and this action's own
 *      `applyReal()` (the plan's §B TOCTOU scenario, lived in by
 *      inventory's INV-2). Takes the simulated-against `World` and
 *      returns the real `World` this action's `applyReal()` will
 *      actually execute against.
 *   - `injectUnrelatedConcurrentDelta` — a DIFFERENT action type
 *      entirely (inventory's `writeOffDamage`, INV-3), landing on the
 *      SAME `World.id` but a path this domain's `project()` never
 *      claims to own. Represented directly as the one `Delta` it
 *      produces (not as a second domain adapter — see ADR 0005 for why a
 *      single, hand-authored `Delta` is the honest, minimal way to model
 *      "some other real writer touched this record").
 */
export interface DomainCase<TState extends Json = Json> {
  readonly id: string;
  readonly domainName: string;
  readonly title: string;
  readonly narrative: string;
  readonly adapter: DomainAdapter<TState>;
  readonly action: Action;
  readonly initialWorld: World<TState>;
  readonly injectConcurrentWrite?: (world: World<TState>) => World<TState>;
  readonly injectUnrelatedConcurrentDelta?: Delta;
  readonly expectedReconciliationStatus: "confirmed" | "drifted" | "unprojected";
  readonly expectedRollbackKind: "runnable" | "unavailable";
  readonly rollbackPolicy: RollbackPolicy;
  /**
   * Which of ADR 0004's two required honesty checks this case's rollback
   * execution takes, when `rollbackPolicy === "execute"`. `undefined` for
   * every other policy (nothing runs, so no check applies). This is the
   * direct, per-case answer to the ADR's own finding: "every M6 call site
   * must take one of the two available honesty checks... taking neither
   * is not a style choice."
   */
  readonly rollbackHonestyCheck?: "assume-no-concurrent-writer" | "verify-honest-inversion";
}
