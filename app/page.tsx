import { MILESTONES, currentMilestone } from "./milestones";

/**
 * Placeholder root page — infrastructure only. The interactive demo is
 * M8's job (see .genesis/PLAN.md); this exists purely so the Next.js app
 * shell has a real route to build and serve before then.
 *
 * Progress is read from app/milestones.ts, never hardcoded into this
 * prose — see that file's comment for why (a hardcoded milestone number
 * on a previous project's public page went stale for two milestones).
 * `doneCount` below is COMPUTED from that module at render time, not a
 * number written here — deliberately, so this comment never has to be
 * edited (and never again risks going stale, the way "as of M2, zero
 * milestones are marked done" did the moment M1 was marked done) just
 * because a milestone's status changed. What still needs saying in prose,
 * because the count alone doesn't say it: nothing on this page should ever
 * imply a working simulator/reconciliation/rollback engine exists — none
 * of lib/simulate, lib/reconcile, or lib/rollback exist yet, regardless of
 * how many milestones are marked done.
 */
export default function Home() {
  const current = currentMilestone();
  const doneCount = MILESTONES.filter((m) => m.status === "done").length;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "2rem 1rem" }}>
      <h1>shadow-run</h1>
      <p>
        Simulate before you act: an agent projects the effects of a write before executing it,
        with a rollback path in front of every write.
      </p>
      <p>
        This is a deploy skeleton. No simulator, reconciliation, or rollback engine exists yet —
        only the typed contracts (M1) and this app shell (M2).
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
    </main>
  );
}
