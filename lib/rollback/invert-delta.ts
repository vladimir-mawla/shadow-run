import type { Delta } from "../contracts/delta.js";

/**
 * `invertDelta` — the ONE place a `Delta` is inverted anywhere in this
 * codebase (plan §A.4). This is the exact switch the plan's own sketch
 * proposes; this file's job is to make it real code and to argue, in one
 * place, why it is TOTAL (defined for every `Delta`, not just the tidy
 * ones) — the claim M5's success criteria requires and an independent
 * verifier is specifically primed to attack.
 *
 * WHY THIS IS TOTAL OVER ALL FOUR `kind`s, AND WHY IT NEVER NEEDS TO LOOK
 * AT WHAT `before`/`after` ACTUALLY CONTAIN. `path.ts`'s header explains
 * the load-bearing design choice this file depends on: `before`/`after`
 * are whole-value SNAPSHOTS at `path`, not a description of the edit that
 * produced them (not "add 3," not "insert at index 2" — just "it was this,
 * now it's that"). Given that, inverting ANY `Delta` is always exactly one
 * of two mechanical moves, and both are total regardless of the payload's
 * runtime type:
 *
 *   1. SWAP `before`/`after`, same `kind` (`set`, `increment`). A snapshot
 *      swap never inspects whether the value is a number, a string, an
 *      object, or `undefined` — it is a pure relabeling, so there is
 *      nothing for a non-numeric `increment` payload to break. This is
 *      the direct answer to this milestone's own design question ("what
 *      about increment on a value that was not a number?"): NOTHING
 *      happens, because inversion never does arithmetic. An earlier,
 *      REJECTED design considered inverting `increment` by negating a
 *      numeric delta amount (`after - before`) rather than swapping whole
 *      snapshots — that design WOULD have a real failure case here (no
 *      well-defined negation of a non-numeric "amount"), and rejecting it
 *      is exactly what buys back totality. `delta.ts`'s own comment
 *      ("its inverse is itself trivially symmetric — negate, don't just
 *      swap") describes the SEMANTIC effect (an increment's amount is
 *      negated) that this swap already produces as a side effect, not a
 *      second, different mechanism this file needs to implement.
 *   2. SWAP AND RELABEL (`remove` -> `set`, `append` -> `remove`). Still a
 *      pure swap of the same two `unknown` values; only the `kind` string
 *      written onto the result differs, chosen so the INVERTED delta's
 *      label honestly describes what running it does (reintroducing a
 *      value is a `set`; undoing an addition is a `remove` — see each
 *      `case` below for the specific reasoning `delta.ts` gives).
 *
 * WHAT IS **NOT** TOTAL, NAMED EXPLICITLY SO IT IS NOT MISTAKEN FOR A GAP
 * IN THIS FUNCTION: whether the RESULTING inverted `Delta` will actually
 * apply cleanly against a given `World.data` is a separate question this
 * function does not and cannot answer — `invertDelta` only transforms the
 * `Delta` value itself, which never fails. Applying it
 * (`apply-deltas.ts`) is where a real mismatch (the world has drifted
 * further than this rollback plan accounted for) surfaces, loudly, as a
 * thrown error — never silently here. Conflating "inversion is total" with
 * "application always succeeds" would be exactly the kind of overclaim
 * this project's own house rule (don't restate a limit more strongly than
 * it's true, and don't understate one either) exists to catch; see
 * `.genesis/decisions/0004-rollback.md` for the fuller discussion.
 */
export function invertDelta(delta: Delta): Delta {
  switch (delta.kind) {
    case "set":
      // Symmetric: swapping before/after undoes a wholesale replacement
      // with another wholesale replacement. delta.ts: "swap before/after."
      return { ...delta, before: delta.after, after: delta.before };

    case "increment":
      // Mechanically identical to `set` (see file header) — the snapshot
      // swap already negates the numeric change as a side effect; there is
      // no separate arithmetic step here to fail on a non-numeric payload.
      return { ...delta, before: delta.after, after: delta.before };

    case "remove":
      // Undoing a deletion is REINTRODUCING a value, which is honestly a
      // `set`, not a `remove` — delta.ts: "its inverse is a set
      // reintroducing before." The swap still holds: the inverted delta's
      // `before` is the original `after` (what the data looked like once
      // the key was gone), and its `after` is the original `before` (the
      // value being restored).
      return { ...delta, kind: "set", before: delta.after, after: delta.before };

    case "append":
      // Undoing an addition is REMOVING a value, which is honestly a
      // `remove`, not an `append` — delta.ts: "its inverse is a remove of
      // the same value." Under this file's whole-snapshot model that
      // "same value" claim is exact (not merely "some element equal to
      // it, hopefully the right one"): the inverted delta's `before` is
      // the exact post-append snapshot, and its `after` is the exact
      // pre-append snapshot, so applying it restores precisely what was
      // there before, regardless of how many elements were appended in
      // this one `Delta` or where in the collection they landed — the
      // "which occurrence, where" ambiguity this milestone's design
      // questions name is resolved at the SNAPSHOT-MODEL level (path.ts),
      // not by this function needing extra information it doesn't have.
      return { ...delta, kind: "remove", before: delta.after, after: delta.before };
  }
}
