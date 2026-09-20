import type { JSX } from "react";
import type { Delta } from "../lib/contracts/index";
import { describeReconciledDelta, formatDeltaValue, type ReconciledDeltaLabel } from "./delta-render-rules";

/**
 * One row: a single `Delta`, in one of two modes.
 *
 *   - PLAIN (no `claim` prop) — a `Delta` from a `ProjectedEffect`,
 *     `ObservedEffect`, or `Rollback.runnable.steps`. Both `before` and
 *     `after` are always genuinely known at that layer (see
 *     `lib/contracts/reconciliation.ts`'s own scoping note: only
 *     `reconcile()`'s output can synthesize a value, never M3's `project()`
 *     or M6's real snapshot diff), so this mode renders the honest
 *     transition, `before → after`, with no guard needed.
 *   - CLAIM (`claim="predicted" | "actual"`) — a `Delta` taken off a
 *     `Reconciliation` (`.drifted.expected`/`.actual`,
 *     `.unprojected.actual`, `.confirmed.matched`), where `actual` may be
 *     synthesized (see `delta-render-rules.ts`'s header). Renders through
 *     `describeReconciledDelta`, the one shared, unconditional rule —
 *     never a second, ad hoc "trust this one" branch here.
 *
 * `path`/`kind` are always shown on their own line from the value, per
 * m8-demo-design.md §8's mobile rule: at 375px, monospace `path → value`
 * text does not reliably fit one line, and shrinking the font to force it
 * would make the numbers — the load-bearing content — harder to read. Two
 * lines, full-size text, is the deliberate trade (CSS wrap, not a JS
 * viewport check — see app/globals.css's `.delta-row`).
 */
interface DeltaRowProps {
  readonly delta: Delta;
  readonly claim?: ReconciledDeltaLabel;
}

export function DeltaRow({ delta, claim }: DeltaRowProps): JSX.Element {
  const valueText = claim
    ? describeReconciledDelta(delta, claim)
    : `${formatDeltaValue(delta.before)} → ${formatDeltaValue(delta.after)}`;

  return (
    <div className="delta-row">
      <div className="delta-row__meta">
        <span className="mono delta-row__path">{delta.path}</span>
        <span className="delta-row__kind">{delta.kind}</span>
      </div>
      <div className="mono delta-row__value">{valueText}</div>
    </div>
  );
}
