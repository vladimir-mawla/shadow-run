import { MILESTONES, currentMilestone } from "./milestones";
import { InventoryDemo } from "../components/InventoryDemo";

/**
 * Root page. Two things share it: the milestone-status prose that has
 * lived here since M2 (kept — it is still true, and app/milestones.ts is
 * still the one place a reader should trust for "how far along is this"),
 * and, below it, the actual interactive demo this whole project is built
 * to show (`sim-plan.md` §B, `.genesis/PLAN.md`'s M8 row).
 *
 * THIS COMMENT USED TO SAY "nothing on this page should ever imply a
 * working simulator/reconciliation/rollback engine exists — none of
 * lib/simulate, lib/reconcile, or lib/rollback exist yet." That was true
 * through M8's first, partial pass (presentational components only, no
 * page wired up) and is FALSE now: M3/M4/M5/M6 are all merged, and
 * `<InventoryDemo />` below calls `simulate()`, `reconcile()`, and
 * `runRollback()` for real, client-side, on every click — leaving the old
 * sentence in place after that stopped being true would be exactly the
 * kind of comment-contradicts-code mistake this project's own discipline
 * exists to catch. `doneCount` is still computed from `app/milestones.ts`
 * at render time rather than hardcoded, for the same "never let a public
 * page's prose go stale" reason M2's own version of this comment gave.
 */
export default function Home() {
  const current = currentMilestone();
  const doneCount = MILESTONES.filter((m) => m.status === "done").length;

  return (
    <main className="page">
      <h1>shadow-run</h1>
      <p>
        Simulate before you act: an agent projects the effects of a write before executing it,
        with a rollback path in front of every write.
      </p>
      <p>
        <strong>
          {doneCount} of {MILESTONES.length} milestones verified done.
        </strong>{" "}
        {current ? (
          <>
            In progress: M{current.id} — {current.title}.
          </>
        ) : (
          "All milestones done."
        )}
      </p>
      <ul>
        {MILESTONES.map((m) => (
          <li key={m.id}>
            M{m.id} — {m.title} ({m.status})
          </li>
        ))}
      </ul>
      <p>
        <a href="/api/health">/api/health</a> reports the deployed commit SHA and a live check of
        the M1 contracts.
      </p>

      <h2>Live demo — inventory.reserve</h2>
      <p>
        Click Simulate, then (optionally) Inject concurrent change one or more times, then Execute.
        Every button below calls the real engine — <code className="mono">simulate()</code>,{" "}
        <code className="mono">reconcile()</code>, <code className="mono">runRollback()</code> — client-side,
        with no network round-trip. Open your browser&rsquo;s Network tab and click through it; nothing fires.
      </p>
      <InventoryDemo />
    </main>
  );
}
