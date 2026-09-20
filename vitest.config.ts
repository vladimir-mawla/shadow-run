import { defineConfig } from "vitest/config";

// Kept deliberately minimal: no framework plugin (no Next.js, no React) because
// lib/ must stay framework-free through M2's Next.js adoption.
//
// "tests/**/*.test.ts" is included from the start (shadow-run's M7 freeze
// boundary is tests/failures/**, per .genesis/PLAN.md) even though nothing
// lives there yet at M1 — an empty include glob costs nothing and matches
// decision-engine's own precedent of adding exactly the directories a later,
// already-planned milestone will need, rather than editing this file again
// once that milestone lands.
//
// "components/**/*.test.ts" (M8, this milestone's partial pass): every test
// under components/__tests__/ exercises a PURE function (delta-render-rules.ts,
// restoration-verdict-logic.ts) — no JSX is rendered and no DOM is touched — so
// the plain "node" environment below is still correct and no framework plugin,
// jsdom, or React-rendering test harness needed to be added to get these to
// run. A future pass that wants to render a component and assert on markup is
// the moment this file's original comment's suggestion (a separate vitest
// project config, so a jsdom/RTL dependency doesn't leak into lib/'s test
// run) becomes the right move; it isn't needed for logic-only tests.
export default defineConfig({
  test: {
    environment: "node",
    // app/ is included so a later milestone's drift guard (mirroring
    // decision-engine's) can run. The dependency direction is unaffected:
    // app/ and components/ may import lib/, never the reverse, and no lib/
    // test imports anything under either.
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.ts", "tests/**/*.test.ts"],
    watch: false,
  },
});
