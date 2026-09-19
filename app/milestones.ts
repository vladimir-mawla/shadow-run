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
 * STATUS AS OF M2: nothing in .genesis/DONE.html's status table is marked
 * `done` yet — M1's code is built and frozen (lib/contracts/**) but is
 * still awaiting independent (L4) verification per this account's
 * standing rule that a milestone is only `done` once a separate agent
 * confirms it, never by the building agent's own say-so. So M1 is marked
 * "in-progress" here, not "done" — matching DONE.html rather than getting
 * ahead of it. M2 (this milestone) is also "in-progress": the code in this
 * PR is import-ready, but the actual Vercel deployment is a human step
 * that has not happened yet (see README/PR for the exact steps).
 */
export interface Milestone {
  readonly id: number;
  readonly title: string;
  readonly status: "done" | "in-progress" | "planned";
}

export const MILESTONES: readonly Milestone[] = [
  { id: 1, title: "Contracts: World, ProjectedEffect, Reconciliation, Rollback", status: "in-progress" },
  { id: 2, title: "Deploy a live skeleton to Vercel", status: "in-progress" },
  { id: 3, title: "The shadow-execution engine (simulate())", status: "planned" },
  { id: 4, title: "Reconciliation and the trust feedback loop", status: "planned" },
  { id: 5, title: "Rollback engine: compensations that actually run", status: "planned" },
  { id: 6, title: "Domains: four adapters wired end to end", status: "planned" },
  { id: 7, title: "The failure suite", status: "planned" },
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
