/**
 * `Delta` is the one field-level change shape shared by every stage of the
 * pipeline: a `ProjectedEffect` is an array of predicted `Delta`s, an
 * `ObservedEffect` (M4) is the same shape computed from real before/after
 * snapshots, a `Reconciliation` diffs two `Delta` arrays, and a `Rollback`'s
 * `steps` is a `Delta` array too — the inverse of an observed one. One
 * shape, four consumers, rather than four near-identical ad hoc diff types
 * that would drift apart the moment one of them needed a new field.
 *
 * WHY FOUR `kind`s, AND WHY THESE FOUR SPECIFICALLY. Chosen against the
 * plan's four domains (calendar reschedule, inventory reservation, outbound
 * notification, infra resize), not built as a general patch language:
 *
 *   - `set`       — replace a scalar or object field wholesale (a calendar
 *                    event's `time`, a feature flag's `enabled` bit).
 *                    Symmetric and trivially invertible: swap `before`/
 *                    `after` (see `invertDelta`, M5's job, not this
 *                    milestone's — `lib/rollback/**` is a later freeze
 *                    boundary).
 *   - `increment`  — a signed numeric change to a counter (`stock.reserved
 *                    += 3`). Kept distinct from `set` specifically because
 *                    it is the one `kind` whose *inverse* is itself
 *                    trivially symmetric (negate, don't just swap) and
 *                    because two concurrent `increment`s on the same path
 *                    (the inventory-reservation TOCTOU case, plan §B) are
 *                    the one shape a reconciler needs to recognize as
 *                    "additive," not "last write wins," when it explains a
 *                    drift.
 *   - `remove`     — delete a value at `path` (a cancelled reservation, a
 *                    revoked flag). Its inverse is a `set` reintroducing
 *                    `before` — asymmetric on purpose, because "undo a
 *                    removal" and "undo a set" are genuinely different
 *                    operations even though both restore a prior value.
 *   - `append`     — add a value to a collection at `path` (a notification
 *                    added to an outbox, a participant added to a
 *                    calendar event). Its inverse is a `remove` of the same
 *                    value — again asymmetric, matching `remove`'s.
 *
 * DELIBERATELY LEFT OUT: a general JSON-Patch-style `move`/`copy`/`test`
 * vocabulary. Every one of this project's four domains (plan §D) is fully
 * expressible in these four `kind`s; a bigger vocabulary would be exactly
 * the "expression language nobody asked for" decision-engine's ADR 0004
 * already rejected for `ValueConstraint`'s operator set, one layer over —
 * see `.genesis/decisions/0001-contracts.md` for the direct citation.
 *
 * `before`/`after` are deliberately `unknown`, not `Json`: a `Delta`
 * describes a change to ONE field inside a `World.data` that is already
 * constrained to `Json` (see `world.ts`) — re-deriving that same constraint
 * per-field here would just be restating a guarantee `World` already owns,
 * for a value this file never constructs on its own (every real `Delta` in
 * this codebase is produced by a domain's `project()`/`applyReal()`, which
 * read from an already-`Json`-typed `World.data`).
 */
export interface Delta {
  /** Where inside `World.data` this change applies, e.g. "stock.reserved". Dot-path convention shared by every domain (M6), not enforced as a type here — see `__tests__/delta.test.ts` for the one runtime shape check this file does own. */
  readonly path: string;
  readonly before: unknown;
  readonly after: unknown;
  readonly kind: "set" | "increment" | "remove" | "append";
}
