import type { JSX } from "react";

/**
 * A small labelled pill with a tone, not tied to any one verdict. Named
 * generically (`StatusChip`, not `RestorationBadge`) because its first use
 * is `RestorationVerdict.tsx`'s primary badge, but the same three tones
 * (a thing held, a thing violated, a thing pending) are the right shape for
 * other verdicts a later M8 pass renders (e.g. a `Reconciliation`
 * confirmed/drifted badge) — this file does not build those callers, only
 * the primitive they would share, per the brief's "keep the component
 * surface small."
 *
 * Tone names are outcomes-of-a-check, not colours — "positive"/"negative"/
 * "neutral" rather than "green"/"red"/"grey" — so a call site reads as a
 * claim about what was checked, not a styling choice. Mirrors
 * decision-engine's own `outcome-badge` discipline (`OutcomeBadge.tsx`) of
 * keying colour off a named class, never an inline style.
 */
export type StatusTone = "positive" | "negative" | "neutral";

interface StatusChipProps {
  readonly tone: StatusTone;
  readonly label: string;
}

export function StatusChip({ tone, label }: StatusChipProps): JSX.Element {
  return <span className={`status-chip status-chip--${tone}`}>{label}</span>;
}
