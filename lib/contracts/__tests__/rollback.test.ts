import { describe, expect, it } from "vitest";
import type { Rollback } from "../rollback.js";
import type { ProjectedEffect } from "../projected-effect.js";

/**
 * M1 success criterion (plan §C, M1): "`@ts-expect-error` proofs that a
 * `Rollback.runnable` literal missing `steps`, or an `unavailable` literal
 * missing `reason`, does not compile." This is the direct, literal proof
 * the milestone brief asks for — see rollback.ts's header comment for why
 * `steps` is required, serializable data rather than an optional closure.
 */

const SAMPLE_PROJECTION: ProjectedEffect = {
  deltas: [{ path: "stock.reserved", before: 39, after: 42, kind: "increment" }],
  resultingFingerprint: "abc12345",
  assumptions: ["no-concurrent-writer"],
  producedBy: "shadow-execution",
};

describe("Rollback.runnable requires steps — a ts-expect-error proof", () => {
  it("compiles when steps is present", () => {
    const rollback: Rollback = {
      kind: "runnable",
      steps: [{ path: "stock.reserved", before: 42, after: 39, kind: "increment" }],
      projectedRestoration: SAMPLE_PROJECTION,
    };
    expect(rollback.kind).toBe("runnable");
  });

  it("TYPE-LEVEL: a runnable literal missing `steps` does not compile", () => {
    // @ts-expect-error — `steps` is required on the "runnable" variant; omitting it must fail to compile, per M1's success criteria.
    const rollback: Rollback = {
      kind: "runnable",
      projectedRestoration: SAMPLE_PROJECTION,
    };
    expect(rollback).toBeDefined();
  });

  it("TYPE-LEVEL: steps cannot be a function — it must be data (ReadonlyArray<Delta>), never a closure", () => {
    const rollback: Rollback = {
      kind: "runnable",
      // @ts-expect-error — steps is ReadonlyArray<Delta>, not a compensating function; a closure is exactly the rejected design (see rollback.ts header).
      steps: (world: unknown) => world,
      projectedRestoration: SAMPLE_PROJECTION,
    };
    expect(rollback).toBeDefined();
  });
});

describe("Rollback.unavailable requires reason — a ts-expect-error proof", () => {
  it("compiles when reason is present", () => {
    const rollback: Rollback = {
      kind: "unavailable",
      reason: "sending a notification has no compensating operation",
      blastRadius: [{ path: "outbox.sent", before: false, after: true, kind: "set" }],
    };
    expect(rollback.kind).toBe("unavailable");
  });

  it("TYPE-LEVEL: an unavailable literal missing `reason` does not compile", () => {
    // @ts-expect-error — `reason` is required on the "unavailable" variant; omitting it must fail to compile, per M1's success criteria.
    const rollback: Rollback = {
      kind: "unavailable",
      blastRadius: [],
    };
    expect(rollback).toBeDefined();
  });

  it("TYPE-LEVEL: an unavailable literal missing `blastRadius` does not compile either — a named reason alone is not enough", () => {
    // @ts-expect-error — `blastRadius` is also required; a reason with no named blast radius is exactly the "asserted, not shown" gap this type exists to close.
    const rollback: Rollback = {
      kind: "unavailable",
      reason: "no compensating operation exists",
    };
    expect(rollback).toBeDefined();
  });
});

describe("Rollback is a real discriminated union, not two unrelated shapes glued together", () => {
  it("narrows to the runnable shape when kind === 'runnable'", () => {
    const rollback: Rollback = {
      kind: "runnable",
      steps: [],
      projectedRestoration: SAMPLE_PROJECTION,
    };
    if (rollback.kind === "runnable") {
      // If this compiles, TypeScript has narrowed `rollback` to the runnable
      // variant purely from the `kind` check — `steps` is accessible without
      // a cast.
      expect(rollback.steps).toEqual([]);
    } else {
      throw new Error("unreachable");
    }
  });

  it("TYPE-LEVEL: `kind` cannot be a third, invented value", () => {
    const rollback: Rollback = {
      // @ts-expect-error — Rollback.kind is a closed union of exactly "runnable" | "unavailable"; a third value must not typecheck.
      kind: "partially-runnable",
      steps: [],
      projectedRestoration: SAMPLE_PROJECTION,
    };
    expect(rollback).toBeDefined();
  });
});
