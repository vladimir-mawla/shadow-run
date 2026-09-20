import type { Delta } from "./delta.js";

/**
 * `AssumptionKind` — a CLOSED, ENGINE-DEFINED enum, never a domain-
 * extensible string and never free text. This is the plan's single
 * hardest constraint on THIS TYPE (§A.5): "no field on `ProjectedEffect`
 * may exist where a model's prose could sit without a type error," and
 * `assumptions` is the one field on `ProjectedEffect` that most tempts a
 * future author to widen it to `string` "just this once" (e.g. "assume the
 * customer doesn't cancel in the next 5 minutes") — exactly the crack a
 * narrated guess would slip through. Keeping it a closed union means every
 * assumption a `project()` implementation can ever declare is one this
 * file already named and the engine already understands the shape of; a
 * domain cannot invent a new one without editing this file, which makes
 * the enum's membership something a reviewer can read in one place, not
 * something scattered across every domain that happens to call
 * `project()`.
 *
 * SCOPE OF THIS CLAIM, STATED EXPLICITLY: it is true of `ProjectedEffect`
 * and false if read as a claim about `lib/contracts/**` as a whole.
 * `World.domain` (world.ts), `Delta.path` (delta.ts),
 * `Rollback.unavailable.reason` (rollback.ts), and
 * `SimulatorTrust.actionType` (simulator-trust.ts) are all plain, open
 * `string` fields, by design — see each file's own comment for why leaving
 * them open is the right call at M1. `ProjectedEffect` is the one type
 * this project is specifically committed to keeping narration-proof; nothing
 * else in this directory makes or needs that promise.
 *
 * The three members are exactly the preconditions a *shadow* execution
 * (plan §A.1 — running the same effect logic against a cloned `World`)
 * needs in order for its prediction to still hold once the real write
 * actually runs:
 *
 *   - "no-concurrent-writer"     — nothing else mutates this `World.id`
 *                                   between the snapshot `project()` read
 *                                   and the real execution. This is the
 *                                   assumption the plan's headline TOCTOU
 *                                   scenario (§B) is built to violate on
 *                                   purpose.
 *   - "world-version-unchanged"  — the `World.version` read at projection
 *                                   time is still current at execution
 *                                   time (a machine-checkable proxy for the
 *                                   assumption above — see M4's use of
 *                                   `World.version`/`fingerprint` to detect
 *                                   a stale read).
 *   - "clock-monotonic"          — nothing about the projection depends on
 *                                   wall-clock time moving backward between
 *                                   projection and execution (relevant to
 *                                   the calendar-reschedule and infra-
 *                                   resize domains, plan §D.1/§D.4, whose
 *                                   deltas can be time-sensitive).
 *
 * Mirrors decision-engine's own `ValueConstraint` operator-set discipline
 * (ADR 0004: "operator set chosen deliberately, kept deliberately small")
 * — see `.genesis/decisions/0001-contracts.md` for why this project
 * follows that precedent rather than starting `assumptions: string[]` and
 * hoping discipline holds.
 */
export type AssumptionKind = "no-concurrent-writer" | "world-version-unchanged" | "clock-monotonic";

/**
 * `ProjectedEffect` — a typed diff, never a sentence (plan §A.1). Produced
 * only by a domain's `project()` (M3's job; M1 just fixes the shape every
 * `project()` must return). Every field here is a value a model's prose
 * cannot occupy without a type error:
 *
 *   - `deltas`               — `ReadonlyArray<Delta>` (delta.ts), not a
 *                               string description of what will change.
 *   - `resultingFingerprint` — the predicted post-action hash, a `string`
 *                               produced only by `computeFingerprint`
 *                               (fingerprint.ts) — never hand-written, so
 *                               it is always comparable, hash-for-hash,
 *                               against a real `World.fingerprint`.
 *   - `assumptions`          — `ReadonlyArray<AssumptionKind>`, the closed
 *                               enum above.
 *   - `producedBy`           — `"shadow-execution"`, a single-value literal
 *                               type. This is a provenance tag enforced
 *                               STRUCTURALLY, not by convention: because
 *                               it is a literal type with exactly one
 *                               valid value, a `ProjectedEffect` object
 *                               literal can only ever claim the one
 *                               provenance this milestone's whole
 *                               architecture is designed to guarantee is
 *                               true (plan §A.2's "Approach C, chosen").
 *                               A caller cannot write `producedBy: "llm-
 *                               guess"` and still satisfy this type — the
 *                               field exists specifically so a reviewer
 *                               reading a `ProjectedEffect` value already
 *                               knows how it was produced, not because
 *                               there is a second real provenance this
 *                               project ever intends to support.
 *
 * NOT parametrized by `TState`, unlike `World<TState>` (world.ts) — a
 * deliberate, verified deviation from the plan's A.5 sketch (which writes
 * `ProjectedEffect<TState>`), recorded in
 * `.genesis/decisions/0001-contracts.md`: none of this type's fields
 * actually depend on the state's shape (`Delta.before`/`after` are already
 * `unknown`, and `resultingFingerprint` is a `string` regardless of what it
 * hashes), so a phantom `TState` parameter would be unused — and this
 * project's tsconfig (`noUnusedLocals`, matching decision-engine's own
 * strictness) makes an unused type parameter an actual compile error
 * (`TS6196`), not a style nit. Adding a real state-shaped field later (e.g.
 * a typed preview of the resulting `World.data`) would be the moment to
 * reintroduce the parameter — not before.
 */
export interface ProjectedEffect {
  readonly deltas: ReadonlyArray<Delta>;
  readonly resultingFingerprint: string;
  readonly assumptions: ReadonlyArray<AssumptionKind>;
  readonly producedBy: "shadow-execution";
}
