import type { JSX } from "react";

/**
 * Two labelled fingerprints, side by side on desktop, stacked on narrow
 * viewports (CSS flex-wrap — `app/globals.css`'s `.fingerprint-pair`, not a
 * JS breakpoint check). Never truncates a value: m8-demo-design.md §8 is
 * explicit that an 8-hex-character `computeFingerprint` output
 * (`lib/contracts/fingerprint.ts`) fits at any reasonable mobile font size,
 * so there is no reason to ellipsize the one string this whole design
 * argues a viewer should be able to eyeball-compare.
 *
 * Deliberately generic (a label/value pair, not "before"/"after" baked in
 * as prop names) — `RestorationVerdict.tsx` is its first real caller, but
 * nothing about this component is specific to a restoration claim.
 */
interface FingerprintItem {
  readonly label: string;
  readonly value: string;
}

interface FingerprintPairProps {
  readonly items: readonly [FingerprintItem, FingerprintItem];
}

export function FingerprintPair({ items }: FingerprintPairProps): JSX.Element {
  return (
    <div className="fingerprint-pair">
      {items.map((item) => (
        <div className="fingerprint-pair__item" key={item.label}>
          <span className="fingerprint-pair__label">{item.label}</span>
          <span className="mono fingerprint-pair__value">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
