/**
 * `SimulatorTrust` — the fifth, SUPPORTING type (plan §A.5's closing note):
 * not one of the four irreducible contracts, because it is derived from
 * `Reconciliation` history rather than an independent fact a domain
 * supplies. It exists in `lib/contracts/**` anyway, at M1, because M4
 * (`lib/reconcile/**`) needs its exact shape frozen before it can implement
 * the feedback loop against it, the same way M4 needs `Reconciliation`
 * itself frozen.
 *
 * A PLAIN, RESET-ON-SUCCESS COUNTER — NOT AN EMA. This is a correction from
 * an earlier draft of this plan (§A.3), which described both a decaying
 * average AND a clean threshold-flip test for it in the same breath — two
 * different statistics that don't share that property. The reasoning,
 * carried forward from the plan rather than re-litigated here in full:
 *
 *   - An EMA's current value depends on the ENTIRE reconciliation history
 *     replayed through the same recurrence relation, not just "how long
 *     since the last confirmed" — a heavier and less legible audit story.
 *   - A decaying average that a single `confirmed` only PARTIALLY forgives
 *     makes "does step N flip the gate, does step N-1 not" a sequence-
 *     dependent question that is harder to state and independently verify
 *     — exactly the kind of claim this project's whole falsifiability
 *     story (plan §0.3) requires to be checkable by a human or a verifier
 *     without needing the decay-rate constant.
 *   - A reset-on-success counter's current value is fully reconstructable
 *     from one small fact — "how many reconciliations back was the last
 *     `confirmed`" — the same small, replayable-fact discipline this
 *     project already applies to `Rollback.runnable.steps` (rollback.ts).
 *
 * The stated, accepted cost (not a free lunch): a domain that alternates
 * `confirmed`/`drifted`/`confirmed`/`drifted`/... never trips the gate
 * under a reset-on-success counter, where a non-resetting or EMA-style
 * statistic eventually would. Accepted here because a hackathon-scale demo
 * needs the threshold behavior to be something a judge or an independent
 * verifier can compute in their head from the sequence on screen.
 *
 * `actionType` is a plain `string`, not yet a closed union — matching
 * `World.domain` (world.ts), which is deliberately left open at M1 because
 * naming the real domains is M6's job (plan §D), not this milestone's.
 */
export interface SimulatorTrust {
  readonly actionType: string;
  /** Every `confirmed` reconciliation resets this to 0; every `drifted`/`unprojected` reconciliation increments it. M4's job to compute; M1 only fixes the shape. */
  readonly consecutiveNonConfirmed: number;
  /** Total reconciliations ever observed for this `actionType`, confirmed or not — kept alongside the resettable counter so a caller can distinguish "0 because it just reset" from "0 because nothing has run yet." */
  readonly totalObserved: number;
}
