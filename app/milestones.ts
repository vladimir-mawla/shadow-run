/**
 * Single source of truth for the progress shown on the landing page
 * (app/page.tsx). Copied as a mechanism from decision-engine's own
 * app/milestones.ts (this project's infrastructure sibling): on that
 * project, the landing page's prose once hardcoded its milestone number
 * directly ("we're on milestone 4...") and that text went stale on a
 * public URL for two whole milestones, because updating it meant
 * remembering to hunt down the sentence. The fix is structural, not
 * procedural: exactly one place — this array — knows the milestone list
 * and each one's status. app/page.tsx only ever reads MILESTONES and
 * currentMilestone(); it never writes a milestone number into its own
 * text.
 *
 * Mirrors the milestone table in .genesis/PLAN.md / .genesis/DONE.html
 * (titles shortened for display). This file is NOT read by the genesis
 * loop tooling — PLAN.md remains the machine-parseable source for loops;
 * this is the human-facing mirror for the deployed page. Keep the two in
 * sync when a milestone's title or status changes — app/milestones.test.ts
 * enforces that the *set of milestones claimed done* never drifts from
 * .genesis/DONE.html, even if this comment is forgotten.
 *
 * STATUS AS OF M2's verification-fix pass: M1 passed independent (L4)
 * verification and its fixes (`makeWorld`, `deepFreezeClone`, accessor
 * rejection, scoped claims) merged to `main` — so M1 is marked "done" here,
 * matching the "done" pill now on its row in .genesis/DONE.html. M2 (this
 * milestone) stays "in-progress": the code in this PR is import-ready, but
 * the actual Vercel deployment is a human step that has not happened yet
 * (see README/PR for the exact steps), and per this account's standing
 * rule a milestone is only `done` once a separate agent confirms it against
 * a real, running deployment — never by the building agent's own say-so
 * because the code looks ready.
 */
export interface Milestone {
  readonly id: number;
  readonly title: string;
  readonly status: "done" | "in-progress" | "planned";
}

export const MILESTONES: readonly Milestone[] = [
  { id: 1, title: "Contracts: World, ProjectedEffect, Reconciliation, Rollback", status: "done" },
  { id: 2, title: "Deploy a live skeleton to Vercel", status: "done" },
  { id: 3, title: "The shadow-execution engine (simulate())", status: "done" },
  { id: 4, title: "Reconciliation and the trust feedback loop", status: "done" },
  { id: 5, title: "Rollback engine: compensations that actually run", status: "done" },
  { id: 6, title: "Domains: four adapters wired end to end", status: "planned" },
  { id: 7, title: "The failure suite", status: "done" },
  { id: 8, title: "The interactive demo", status: "planned" },
  { id: 9, title: "Deliverables", status: "planned" },
] as const;

/**
 * The milestone the page should describe as "current". Prefers an
 * in-progress milestone; falls back to the first not-yet-done one if none
 * is explicitly marked in-progress (e.g. between loop runs); returns
 * undefined only if every milestone is done, in which case the page
 * should say so rather than name a milestone at all.
 */
export function currentMilestone(): Milestone | undefined {
  return (
    MILESTONES.find((m) => m.status === "in-progress") ??
    MILESTONES.find((m) => m.status === "planned")
  );
}
