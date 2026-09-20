import { defineConfig } from "vitest/config";

// Kept deliberately minimal: no framework plugin (no Next.js, no React) because
// lib/ must stay framework-free through M2's Next.js adoption. Later milestones
// that add app/ or components/ can layer a separate vitest project config on
// top of this one rather than editing it, so M1's config never has to know
// about UI concerns.
//
// "tests/**/*.test.ts" is included from the start (shadow-run's M7 freeze
// boundary is tests/failures/**, per .genesis/PLAN.md) even though nothing
// lives there yet at M1 — an empty include glob costs nothing and matches
// decision-engine's own precedent of adding exactly the directories a later,
// already-planned milestone will need, rather than editing this file again
// once that milestone lands.
export default defineConfig({
  test: {
    environment: "node",
    // app/ is included so a later milestone's drift guard (mirroring
    // decision-engine's) can run. The dependency direction is unaffected:
    // app/ may import lib/, never the reverse, and no lib/ test imports
    // anything under app/.
    // "domains/**/*.test.ts" added at M6 — the same pre-added-ahead-of-need precedent this file already
    // set for app/** and tests/** above: M6's freeze boundary (.genesis/PLAN.md) is "domains/**,
    // scripts/demo-domains.ts", not lib/**, so this edit does not touch the frozen boundary; it only
    // teaches vitest where M6's own tests live.
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "tests/**/*.test.ts", "domains/**/*.test.ts"],
    watch: false,
  },
});
