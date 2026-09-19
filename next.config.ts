import type { NextConfig } from "next";

/**
 * BUNDLER RECONCILIATION (the real surprise of M2, beyond the tsconfig
 * split — see tsconfig.json / tsconfig.lib.json):
 *
 * lib/ is frozen from M1 and every file in it uses relative imports with
 * an explicit ".js" extension pointing at a sibling ".ts" file (e.g.
 * lib/contracts/fingerprint.ts imports "./world.js", which is really
 * world.ts — the standard TypeScript `moduleResolution: "bundler"`
 * idiom, understood by tsc and by esbuild/Vite, which is why `npm test`
 * (vitest, esbuild-powered) has always resolved it fine).
 *
 * Next.js's bundlers do NOT resolve that pattern the same way:
 *   - Turbopack (Next 16's default, used by plain `next dev` / `next
 *     build`) fails outright — "Module not found" — for every one of
 *     lib/'s internal ".js"-suffixed imports. No Turbopack option in this
 *     Next version (`turbopack.resolveExtensions`, `resolveAlias`) makes
 *     it treat an explicit ".js" specifier as also matching a ".ts" file;
 *     those options only affect extension-less imports.
 *   - webpack resolves it once told to, via the (experimental, but
 *     verified working end-to-end below) `experimental.extensionAlias`
 *     option, mirroring webpack 5's native `resolve.extensionAlias`.
 *
 * So this project pins the webpack bundler explicitly (`next dev
 * --webpack`, `next build --webpack` in package.json) rather than
 * Turbopack's default, and declares the alias here. This was verified,
 * not assumed: `next build --webpack` succeeds, and running `next dev
 * --webpack` and curling /api/health returns a correct 200 whose body
 * comes from actually importing lib/contracts/index (via its ".js"-
 * suffixed internal imports) and running computeFingerprint/
 * assertPlainData inside the deployed process — see app/api/health/
 * route.ts's own comment for what that check proves. The alternative —
 * editing lib/'s import style to drop the ".js" extensions — was rejected
 * because lib/ is frozen: `git diff main -- lib/` must stay empty.
 *
 * Cost of this choice: the app builds one version behind Next's new
 * default bundler until either Turbopack adds an extension-alias
 * equivalent, or a later milestone recompiles lib/ into real .js output
 * as a build step instead of importing the .ts sources directly.
 *
 * The mechanism (pin webpack, alias ".js" to also match ".ts"/".tsx") and
 * this comment's structure are carried into shadow-run from decision-
 * engine (this project's infrastructure sibling) per this project's own
 * house rule: this is shared build tooling, not conceptual code, and the
 * reconciliation it documents is a property of this repo's TypeScript/
 * Next.js version combination, not of what either project's lib/ actually
 * computes. The worked example above was re-verified against shadow-run's
 * own lib/contracts and app/api/health, not copied from decision-engine's.
 */
const nextConfig: NextConfig = {
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
};

export default nextConfig;
