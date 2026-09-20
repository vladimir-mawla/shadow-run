import type { Delta } from "../../lib/contracts/index.js";

/**
 * `growArraySteps` — the ONE place every domain in this milestone that
 * grows an existing array field (calendar's `attendees`, inventory's
 * `reservations`, notification's `deliveryLog`) goes to get its raw,
 * engine-facing `Delta` pair. See `.genesis/decisions/0005-domains.md`
 * §"A discovered conflict" for the full write-up; this header states the
 * conclusion, not the investigation.
 *
 * WHY TWO STEPS (`remove` THEN `append`), NOT ONE `append`, AND WHY THIS
 * IS NOT THE DESIGN DOC'S LITERAL SHAPE: `lib/simulate`'s frozen
 * `consistency.ts` (M3) checks an `"append"` delta by requiring the
 * CURRENT value at `path` to be `undefined` — "the path is expected to
 * NOT exist yet" (that file's own header), proven by its own test suite
 * exercising `append` ONLY as a scalar leaf coming into existence from
 * total absence (`__tests__/consistency.test.ts`: `path: "a.b", before:
 * undefined, after: 99`). `lib/rollback`'s frozen `path.ts`/ADR 0004
 * (Decision 1), written later, chose the OPPOSITE model for the SAME
 * `Delta.kind`: `before`/`after` are the WHOLE collection, snapshotted —
 * so a real `append` to an already-populated (or even present-but-empty)
 * array ALWAYS has a non-`undefined` current value at its path, which is
 * EXACTLY what M3's `checkConsistency` rejects, unconditionally, for
 * every one of this milestone's four domains' real cases. Both files are
 * frozen (M3, M5); neither is this milestone's to edit
 * (`.genesis/PLAN.md`'s M6 scope). This is a genuine, discovered
 * disagreement between two frozen milestones about what the SAME
 * `Delta.kind` value means — reported to the orchestrator (ADR 0005),
 * not silently patched over in `lib/**`.
 *
 * THE WORKAROUND, ENTIRELY WITHIN `domains/**`'s OWN AUTHORITY: retire
 * the OLD whole-array value with a `remove` (satisfies M3's GENERIC
 * before-check: the current value is defined and equals `before`), then
 * bring the NEW whole-array value into existence with an `append` FROM
 * the now-`undefined` leaf `remove` just deleted (satisfies M3's
 * `append`-specific check: current is now genuinely `undefined`). This
 * is not a trick played on the checker — it is a literal, correct
 * two-step account of "the old collection value stops being there, then
 * a new one starts being there," which is all a whole-value-snapshot
 * `Delta` ever claims about a collection change regardless of `kind`
 * (ADR 0004, Decision 1: there is no element-level information in this
 * model at all). Run in order through `applyDeltas`
 * (`lib/rollback/apply-deltas.ts`), it produces exactly the same final
 * `World.data` as directly overwriting the array would.
 *
 * `netDeltas` (`domains/shared/net.ts`) collapses this pair back down to
 * the single net `{ path, before: oldArray, after: newArray, kind:
 * "append" }` for `ProjectedEffect`/reconciliation purposes — so
 * everything reconciliation-facing prints and compares EXACTLY the
 * single-delta shape `m6-domain-cases.md`'s own design doc describes;
 * only the raw, engine-facing pipeline (`applyReal`, `proposeRollback`)
 * carries the two-step form this file produces.
 */
export function growArraySteps(path: string, before: ReadonlyArray<unknown>, after: ReadonlyArray<unknown>): readonly [Delta, Delta] {
  return [
    { path, before, after: undefined, kind: "remove" },
    { path, before: undefined, after, kind: "append" },
  ];
}
