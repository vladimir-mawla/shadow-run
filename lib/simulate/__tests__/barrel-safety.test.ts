import { describe, expect, it } from "vitest";
// @ts-expect-error — asProjectedEffect is deliberately not exported from lib/simulate/index.ts (see that file's header): this import must fail to compile, not merely be discouraged. It is still importable directly from "../effect-validation.js" — that file, not this barrel, is where it belongs.
import { asProjectedEffect } from "../index.js";
import type { SimulationResult } from "../index.js";

/**
 * Regression test for a real, exploit-confirmed defect (found by
 * independent verification, not written in advance as a precaution):
 * `asProjectedEffect` — a bare, zero-validation cast — was exported from
 * `index.ts`, letting any external caller bypass all four of
 * `simulate()`'s fail-closed gates in one import, without ever calling
 * `simulate()`:
 *
 *   const smuggled = asProjectedEffect({ deltas: "not even an array" });
 *   const fakeResult: SimulationResult = { ok: true, effect: smuggled };
 *
 * compiled clean and produced `{ ok: true, effect: { deltas: "not even
 * an array" } }` at runtime before the fix. See `index.ts`'s header for
 * the full account and `effect-validation.ts`'s header for why the
 * function itself still exists, just not exported.
 *
 * This is proven the way `lib/contracts/__tests__/` proves its own
 * compile-time guarantees: a `@ts-expect-error` at the import site
 * above. It is not a runtime `expect(...).toThrow()` — the whole point
 * is that the exploit's import line must no longer COMPILE, and `tsc`
 * (run by `npm run typecheck`, and by `npm test`'s own transform step)
 * is what actually checks that, not this file's assertions.
 */
describe("asProjectedEffect is not part of the public barrel", () => {
  it("the barrel import above only typechecks because of the ts-expect-error; at runtime the binding is undefined, never a usable function", () => {
    expect(asProjectedEffect).toBeUndefined();
  });
});

/**
 * The OTHER half of the finding — confirmed already sound by independent
 * verification and deliberately NOT changed by this fix — is that
 * `SimulationResult`'s own discriminated-union narrowing was never the
 * problem: a caller cannot reach `.effect` off a value narrowed to the
 * `{ ok: false }` branch. Kept here as a permanent guard against a future
 * edit accidentally widening the union back into that hole.
 */
describe("SimulationResult's own type-level narrowing (the part that was never broken)", () => {
  it("TYPE-LEVEL: a value narrowed to ok:false has no .effect field to read", () => {
    const result: SimulationResult = { ok: false, failure: { kind: "adapter-threw", error: "boom" } };
    if (!result.ok) {
      // @ts-expect-error — `result` is narrowed to the `{ ok: false }` variant here, which has no `effect` field at all; reading one must fail to compile, not merely return `undefined` at runtime.
      const stolen = result.effect;
      expect(stolen).toBeUndefined();
    } else {
      throw new Error("unreachable");
    }
  });
});
