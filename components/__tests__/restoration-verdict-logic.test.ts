import { describe, expect, it } from "vitest";
import { computeFingerprint } from "../../lib/contracts/index";
import { isFullyRestored } from "../restoration-verdict-logic";

describe("isFullyRestored", () => {
  it("is true for deep-equal, non-identical data (fresh objects, same fields)", () => {
    const restored = { reserved: 40, available: 110, reservations: [{ orderId: "ord-5534", qty: 3 }] };
    const preAction = { reserved: 40, available: 110, reservations: [{ orderId: "ord-5534", qty: 3 }] };
    expect(isFullyRestored(restored, preAction)).toBe(true);
  });

  it("is false when any field genuinely differs", () => {
    const restored = { reserved: 41, available: 110 };
    const preAction = { reserved: 40, available: 110 };
    expect(isFullyRestored(restored, preAction)).toBe(false);
  });

  /**
   * The load-bearing test for the whole two-tier design (m8-demo-design.md §2):
   * re-runs the project's OWN shipped `computeFingerprint` — not a hand-copied
   * digit — to confirm the collision fact the RestorationVerdict disclosure
   * quotes on screen, then proves `isFullyRestored` is not fooled by it. If
   * either assertion below ever failed, the design's central claim (the badge
   * cannot be driven by hash equality alone) would be false and printing the
   * disclosure text would be a lie on screen, not a caveat.
   */
  it("is false for the project's own verified fingerprint collision, proving the badge cannot rely on the hash", () => {
    const stateA = { reserved: 412789 };
    const stateB = { reserved: 649192 };

    const fingerprintA = computeFingerprint(stateA);
    const fingerprintB = computeFingerprint(stateB);
    expect(fingerprintA).toBe(fingerprintB);
    expect(fingerprintA).toBe("2ba95242");

    // Same fingerprint; NOT the same state. The primary badge must say so.
    expect(isFullyRestored(stateA, stateB)).toBe(false);
  });
});
