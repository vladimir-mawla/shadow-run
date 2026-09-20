import type { Json, ProjectedEffect, World } from "../contracts/index.js";
import type { Action } from "./action.js";

/**
 * `SimulationAdapter<TState>` — the interface a domain contributes to run
 * `simulate()` against it. This is `sim-plan.md` §A.2's Approach C made
 * concrete: "every domain contributes a deterministic
 * `project(action, world): ProjectedEffect`... No model call is reachable
 * from this function; its type signature has no slot for one." Two design
 * choices below are exactly how this type signature closes that door
 * structurally, not just by naming convention — see
 * `.genesis/decisions/0002-simulate.md` for the alternatives rejected for
 * each.
 *
 * CHOICE 1 — `project` IS SYNCHRONOUS: `(action, world) => ProjectedEffect`,
 * never `=> Promise<ProjectedEffect>`. This is a SECOND, INDEPENDENT
 * structural barrier against Approach A, on top of M3's grep-based
 * architectural test (`__tests__/architecture.test.ts`) that bans network/
 * LLM-client imports outright. The two defenses are not redundant: the
 * grep test can only ever enumerate specifiers and patterns it was told
 * to look for (see that file's own header for the "allowlist over
 * denylist" reasoning) — a signature that FORBIDS `Promise` closes an
 * entire CLASS of evasion the grep test cannot see coming, because
 * essentially every real way to call an LLM or a third-party API from
 * Node is inherently asynchronous (there is no synchronous `fetch`, and
 * Node's `fetch`/HTTP client APIs are Promise-based by construction). A
 * `project()` that tried to synchronously return a value depending on a
 * network response would have nothing to `await` and no legal way to
 * block for it — it isn't merely discouraged, it doesn't fit the shape.
 *
 * A KNOWN, ORDINARY EXCEPTION, NAMED PLAINLY (tightened after independent
 * verification — the earlier wording here undersold this as needing "a
 * sufficiently determined implementation," which is not what this is):
 * ESM top-level `await`, run once at MODULE INITIALIZATION time, before
 * `project()` is even called. An adapter's module can `await` a real
 * network/LLM call at the top level; by the time `project()` runs, that
 * value is already an ordinary, already-resolved, in-memory constant —
 * `project()` itself is genuinely synchronous by every measure this
 * function's own signature or `simulate()` can check, and confirmed to
 * pass `simulate()` cleanly (`ok: true`, returning the prefetched value)
 * end to end. This is not a contrived attack: it is the single most
 * idiomatic way to prefetch something in modern Node ESM — no `deasync`,
 * no worker-thread bridge, no blocking IPC hack required. Nor can M3's
 * grep-based architectural test help here even in principle: that test's
 * frozen boundary is `lib/simulate/**` (this file included), but a real
 * domain adapter's own module lives in `domains/**` (M6's directory,
 * outside this milestone's scan and outside its freeze boundary
 * entirely) — there is no file for the grep test to have read. Recorded
 * here as a genuine, unresolved gap for M6 to inherit, not something
 * this milestone's synchronous-signature choice actually closes; see
 * `simulate.ts`'s own header for the matching honesty about what CAN and
 * cannot be structurally guaranteed for purity, which has the identical
 * shape of caveat.
 *
 * CHOICE 2 — `project` NEVER RECEIVES THE REAL, LIVE `World`: `simulate()`
 * (simulate.ts) hands it a freshly `deepFreezeClone`d copy nobody else
 * holds a reference to, regardless of whether the caller's own `World`
 * was already frozen. An adapter therefore cannot mutate real state even
 * if it tried, and cannot leak a reference to real state, out of this
 * function's own type signature — see `simulate.ts` for where that clone
 * actually happens and why (ADR 0001's forward note to reuse
 * `deepFreezeClone` rather than write a second deep-freeze walk).
 *
 * `project` may still THROW (a bug, a deliberately-malicious test fixture,
 * an out-of-range parameter) — `simulate()` catches that and turns it into
 * a named `SimulationResult` failure (`result.ts`) rather than letting it
 * propagate raw; see that file's header for why "the engine validates the
 * adapter's output" extends to "the engine survives the adapter throwing"
 * as the same fail-closed discipline, not a separate concern.
 */
export interface SimulationAdapter<TState extends Json> {
  readonly project: (action: Action, world: World<TState>) => ProjectedEffect;
}
