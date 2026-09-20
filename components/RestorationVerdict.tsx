import type { JSX } from "react";
import { isFullyRestored } from "./restoration-verdict-logic";
import { FingerprintPair } from "./FingerprintPair";
import { StatusChip } from "./StatusChip";

/**
 * THE TWO-TIER RESTORATION VERDICT (m8-demo-design.md §2, implemented as
 * specified there, not re-litigated here):
 *
 *   1. PRIMARY BADGE — large, the thing a skimming stranger reads. Driven
 *      ONLY by `isFullyRestored` (`restoration-verdict-logic.ts`), which is
 *      `deepEqual(restoredData, preActionData)` and nothing else. This is
 *      the one element on this screen making a restoration claim, so it is
 *      the one element backed by the system's authoritative check — never
 *      the fingerprint comparison below.
 *   2. CORROBORATING FINGERPRINTS — same visual weight as any other delta
 *      row, deliberately NOT shrunk to disclaimer-grey. Under-selling a
 *      true, useful signal is its own dishonesty (this account's standing
 *      "don't restate limits more strongly than they're true" note cuts
 *      both directions: it also forbids UNDER-stating a real signal to
 *      seem more humble). Labelled "fingerprint match" — a factual label
 *      for a factual comparison, never "proof" or "verified."
 *   3. THE DISCLOSURE — permanently visible (a native `<details>`, not a
 *      settings menu or a hover-only tooltip), because a judge who knows
 *      hashing will ask "couldn't two different states hash the same?"
 *      within the first ten seconds of seeing a hash-equality claim, and a
 *      demo with no answer ready reads as unaware or evasive. The fact
 *      inside is quoted from `restoration-verdict-logic.ts`'s own header,
 *      which is itself re-verified by this file's sibling test — never
 *      restated as a bigger or smaller claim than what was actually run.
 *
 * `beforeFingerprint`/`afterFingerprint` are plain display strings, not
 * computed here — this component renders a `Reconciliation`/rollback
 * result it is GIVEN, it does not call `computeFingerprint` itself, the
 * same "render, don't produce" line the M8 brief draws for every component
 * in this file's directory.
 */
interface RestorationVerdictProps {
  readonly restoredData: unknown;
  readonly preActionData: unknown;
  readonly beforeFingerprint: string;
  readonly afterFingerprint: string;
}

export function RestorationVerdict({
  restoredData,
  preActionData,
  beforeFingerprint,
  afterFingerprint,
}: RestorationVerdictProps): JSX.Element {
  const restored = isFullyRestored(restoredData, preActionData);

  return (
    <div className="restoration-verdict">
      <StatusChip
        tone={restored ? "positive" : "negative"}
        label={restored ? "Restored ✓ — every field matches" : "NOT restored — see below"}
      />

      <div className="restoration-verdict__corroborating">
        <span className="restoration-verdict__corroborating-label">fingerprint match</span>
        <FingerprintPair
          items={[
            { label: "fingerprint before", value: beforeFingerprint },
            { label: "fingerprint after", value: afterFingerprint },
          ]}
        />
      </div>

      <details className="restoration-verdict__disclosure">
        <summary>Why isn&rsquo;t the hash the proof?</summary>
        <p>
          Fingerprints are a 32-bit hash — fast to compare, but two different states can share
          one. In this project&rsquo;s own inventory field, <code className="mono">{"{reserved: 412789}"}</code>{" "}
          and <code className="mono">{"{reserved: 649192}"}</code> both hash to{" "}
          <code className="mono">2ba95242</code>. The checkmark above never trusts the hash alone
          — it re-compares every field.
        </p>
      </details>
    </div>
  );
}
