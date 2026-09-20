import { describe, expect, it } from "vitest";
import type { AssumptionKind, ProjectedEffect } from "../projected-effect.js";

/**
 * M1 success criterion (plan §C, M1): "`ProjectedEffect.assumptions` is
 * `ReadonlyArray<AssumptionKind>`, a closed enum — not free text. No field
 * on `ProjectedEffect` may exist where a model's prose could sit without a
 * type error." Scoped deliberately to `ProjectedEffect` — other types in
 * `lib/contracts/**` (`World.domain`, `Delta.path`,
 * `Rollback.unavailable.reason`, `SimulatorTrust.actionType`) have
 * deliberately open `string` fields; see projected-effect.ts's own header
 * for why `ProjectedEffect` specifically is held to this narrower,
 * stronger standard. This file proves both halves of the `ProjectedEffect`
 * claim: `assumptions` rejects a value outside the closed set, and
 * `producedBy` — the OTHER field a narrated guess could try to occupy —
 * rejects anything but its one literal value.
 */

const VALID_EFFECT: ProjectedEffect = {
  deltas: [{ path: "stock.reserved", before: 39, after: 42, kind: "increment" }],
  resultingFingerprint: "abc12345",
  assumptions: ["no-concurrent-writer", "world-version-unchanged"],
  producedBy: "shadow-execution",
};

describe("ProjectedEffect.assumptions is a closed, engine-defined enum", () => {
  it("accepts every real AssumptionKind member", () => {
    const allThree: ReadonlyArray<AssumptionKind> = [
      "no-concurrent-writer",
      "world-version-unchanged",
      "clock-monotonic",
    ];
    const effect: ProjectedEffect = { ...VALID_EFFECT, assumptions: allThree };
    expect(effect.assumptions).toHaveLength(3);
  });

  it("TYPE-LEVEL: a free-text assumption string does not compile — this is the exact 'model's prose' failure mode the type must reject", () => {
    const effect: ProjectedEffect = {
      ...VALID_EFFECT,
      // @ts-expect-error — "assume the customer doesn't cancel" is prose, not a member of the closed AssumptionKind union; it must not typecheck.
      assumptions: ["assume the customer doesn't cancel in the next 5 minutes"],
    };
    expect(effect).toBeDefined();
  });

  it("TYPE-LEVEL: a plausible-but-uncoined assumption name does not compile either — the set is closed, not merely 'usually one of these'", () => {
    const effect: ProjectedEffect = {
      ...VALID_EFFECT,
      // @ts-expect-error — "no-network-partition" is a real-sounding but non-member string; the union does not widen to accept it.
      assumptions: ["no-network-partition"],
    };
    expect(effect).toBeDefined();
  });

  it("TYPE-LEVEL: assumptions is not bare `string[]` — a caller cannot bypass the enum by widening the array's element type", () => {
    const notAssumptions: string[] = ["anything at all"];
    // @ts-expect-error — ReadonlyArray<AssumptionKind> is not assignable from string[]; the closed union does not accept a plain string array.
    const effect: ProjectedEffect = { ...VALID_EFFECT, assumptions: notAssumptions };
    expect(effect).toBeDefined();
  });
});

describe("ProjectedEffect.producedBy is a structural provenance tag, not a free-text claim", () => {
  it("accepts only the one real literal value", () => {
    expect(VALID_EFFECT.producedBy).toBe("shadow-execution");
  });

  it("TYPE-LEVEL: a narrated provenance value does not compile", () => {
    const effect: ProjectedEffect = {
      ...VALID_EFFECT,
      // @ts-expect-error — producedBy admits exactly one literal; a model's own claim about itself is not assignable here.
      producedBy: "llm-guess",
    };
    expect(effect).toBeDefined();
  });
});

describe("ProjectedEffect.deltas is a typed diff, never a sentence", () => {
  it("TYPE-LEVEL: a string summary is not assignable to deltas", () => {
    const effect: ProjectedEffect = {
      ...VALID_EFFECT,
      // @ts-expect-error — deltas must be a ReadonlyArray<Delta>; a prose summary is not a Delta array.
      deltas: "stock.reserved goes from 39 to 42",
    };
    expect(effect).toBeDefined();
  });
});
