import {
  assertPlainData,
  computeFingerprint,
  NonPlainDataError,
} from "../../../lib/contracts/index";

/**
 * Force dynamic + Node.js runtime: without `dynamic = "force-dynamic"`,
 * Next.js may treat this route as statically renderable and serve a
 * prerendered response from build time forever after — at which point the
 * "live" contracts check below becomes theatre, run once at build and
 * never again, and the commit SHA below would freeze at whatever it was
 * during the build that produced the static output. The Node.js runtime
 * (the default for route handlers, named explicitly here so it's not an
 * accident of a default that could change) is required because this route
 * imports lib/ directly, and lib/'s tests and this project's whole premise
 * assume real Node semantics, not the edge runtime's restricted subset.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ContractsCheckResult {
  readonly pass: boolean;
  readonly elapsedMs: number;
  readonly detail: string;
}

/**
 * Real work, not a liveness ping — adapted from decision-engine's own
 * app/api/health/route.ts (which exercises its cost model on every
 * request), scoped to what THIS project has actually built by M2: only
 * lib/contracts/** (M1) exists so far. lib/simulate, lib/reconcile, and
 * lib/rollback are M3–M5 and do not exist yet, so this check cannot (and
 * must not pretend to) exercise them.
 *
 * Exercises the two load-bearing runtime guarantees `lib/contracts/world.ts`
 * and `fingerprint.ts` document but that a passing `npm test` alone doesn't
 * prove is still true in THIS deployed process, on THIS Node version:
 *
 *   1. `computeFingerprint` is a pure function of `data` ALONE, independent
 *      of key insertion order (fingerprint.ts's own file-header claim) —
 *      checked here by hashing the same logical object built two different
 *      ways and asserting the hashes match.
 *   2. `assertPlainData` actually rejects a function-bearing value at
 *      runtime (world.ts's "two ways at once" enforcement) — checked here
 *      by handing it a value with a closure and asserting it throws
 *      `NonPlainDataError`, not merely that a hand-written `@ts-expect-error`
 *      compiles (that's `npm run typecheck`'s job, already covered).
 *
 * If either check fails — or anything here throws — this reports failure;
 * it never lets an exception escape past the health endpoint.
 */
function runContractsCheck(): ContractsCheckResult {
  const start = performance.now();
  try {
    const hashA = computeFingerprint({ id: "sku-42", qty: 3 });
    const hashB = computeFingerprint({ qty: 3, id: "sku-42" });
    const deterministic = hashA === hashB;

    let rejectsFunctions = false;
    try {
      assertPlainData({ onCancel: () => {} }, "health-check");
    } catch (err) {
      rejectsFunctions = err instanceof NonPlainDataError;
    }

    const pass = deterministic && rejectsFunctions;
    return {
      pass,
      elapsedMs: performance.now() - start,
      detail: pass
        ? `computeFingerprint is key-order-independent (${hashA}) and assertPlainData rejects a function-bearing value`
        : `contracts check failed: deterministic=${deterministic} rejectsFunctions=${rejectsFunctions}`,
    };
  } catch (err) {
    return {
      pass: false,
      elapsedMs: performance.now() - start,
      detail: `contracts check threw: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

export async function GET(): Promise<Response> {
  const contracts = runContractsCheck();

  const body = {
    status: contracts.pass ? "ok" : "degraded",
    // Set FOR us by Vercel on every deployment — see .env.example. Unset in
    // local dev, where the honest answer is "unknown," never a guessed or
    // hardcoded SHA: a health endpoint that fabricates its own provenance
    // is worse than one that admits it doesn't know.
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown (local dev)",
    checks: {
      contracts: {
        pass: contracts.pass,
        elapsedMs: Math.round(contracts.elapsedMs * 1000) / 1000,
        detail: contracts.detail,
      },
    },
  };

  // Fail closed: a health endpoint that reports 200 while the one thing it
  // actually verified is broken is worse than no health endpoint at all.
  return Response.json(body, { status: contracts.pass ? 200 : 503 });
}
