import type { Action } from "../../lib/simulate/index.js";
import type { AssumptionKind, Delta, ProjectedEffect, Rollback, World } from "../../lib/contracts/index.js";
import { applyDeltas } from "../../lib/rollback/index.js";
import type { AppliedReal, DomainAdapter } from "../types.js";
import { growArraySteps } from "../shared/grow.js";
import { netDeltas } from "../shared/net.js";

/**
 * Outbound notification — the no-rollback-possible domain. See
 * `.genesis/decisions/0005-domains.md` §Notification and
 * `m6-domain-cases.md` §3: this is the one domain whose real effect has
 * NO inverse `Delta` at any point, not "expensive," genuinely
 * uninvertible — once delivered, no `Delta` means "the recipient never
 * read it." A synthetic, in-memory send only (per `sim-plan.md` §0.4 —
 * no real email provider is ever called): `applyReal` below is the
 * entire "send," appending a delivery record and nothing more.
 */
// A TYPE ALIAS to an object literal, not an `interface` — see `calendar/domain.ts`'s identical note.
export type NotificationCampaignState = {
  readonly campaignId: string;
  readonly template: string;
  readonly recipient: string;
  readonly outbox: ReadonlyArray<{ readonly messageId: string; readonly queuedAt: string }>;
  readonly deliveryLog: ReadonlyArray<{
    readonly messageId: string;
    readonly sentAt: string;
    readonly channel: "email";
    readonly status: "delivered";
  }>;
};

const ASSUMPTIONS: ReadonlyArray<AssumptionKind> = ["world-version-unchanged"];

function computeSteps(action: Action, world: World<NotificationCampaignState>): Delta[] {
  if (action.type !== "send") {
    throw new Error(`notification domain: unknown action type "${action.type}"`);
  }
  const params = action.params as { readonly messageId: string; readonly sentAt: string };
  const before = world.data.deliveryLog;
  const after = [...before, { messageId: params.messageId, sentAt: params.sentAt, channel: "email" as const, status: "delivered" as const }];
  // `growArraySteps`, not a single `append` delta — see
  // `domains/shared/grow.ts`'s header for the discovered M3/M5 conflict
  // this works around.
  return [...growArraySteps("deliveryLog", before, after)];
}

// `deltas: steps` — the RAW pipeline, not netted; see `domains/calendar/domain.ts`'s `project()` for the
// full reasoning (identical here): `checkConsistency` needs the raw `growArraySteps` pair to accept the
// `deliveryLog` append at all; netting for `reconcile()` happens entirely in `scripts/demo-domains.ts`.
function project(action: Action, world: World<NotificationCampaignState>): ProjectedEffect {
  const steps = computeSteps(action, world);
  const final = applyDeltas(world, steps);
  return {
    deltas: steps,
    resultingFingerprint: final.fingerprint,
    assumptions: ASSUMPTIONS,
    producedBy: "shadow-execution",
  };
}

function applyReal(action: Action, world: World<NotificationCampaignState>): AppliedReal<NotificationCampaignState> {
  const steps = computeSteps(action, world);
  return { world: applyDeltas(world, steps), observedDeltas: steps };
}

/**
 * A CONSTANT function, per the design doc's own summary: "Notification's
 * `proposeRollback` is a constant function: it always returns the same
 * `unavailable` shape for `notification.send`, computed from the observed
 * `deliveryLog` append, never from a real attempt to find an inverse."
 * `worldBeforeThisWrite` is intentionally unused (matched by `_`-prefix
 * convention below) — every input to this function still produces the
 * identical verdict shape, because the reason it is `unavailable` is a
 * property of the ACTION TYPE ("delivered" has no undo), never of which
 * particular `World` it ran against.
 *
 * WHAT MAKES THIS GENUINELY UNAVAILABLE, AS DATA, NOT JUDGMENT (the
 * design question `.genesis/decisions/0005-domains.md` §Notification
 * answers in full): there is no `Delta.kind` whose inversion means "this
 * was never read" — `remove`'s inverse re-introduces a value (dishonest:
 * the message really was sent) and there is no fifth `kind` this frozen
 * vocabulary offers for "made true, permanently, no compensating write."
 * `blastRadius` is therefore the REAL observed append itself (never a
 * fabricated `steps` list that would apply cleanly while lying about
 * restoring anything) — the one true, permanent effect this action had.
 * `netDeltas(observedDeltas)` here, not the raw `growArraySteps` pair:
 * `blastRadius` is read-only, human-facing data — nothing downstream ever
 * feeds it back into `checkConsistency` or `reconcile()` — so there is no
 * reason to show a reader the internal `remove`-then-`append` workaround
 * (`domains/shared/grow.ts`) instead of the one real, net effect: this
 * message got delivered.
 */
function proposeRollback(
  observedDeltas: ReadonlyArray<Delta>,
  _worldBeforeThisWrite: World<NotificationCampaignState>,
): Rollback {
  return {
    kind: "unavailable",
    reason:
      "A delivered notification has no compensating write: there is no Delta whose inversion means " +
      '"the recipient never read this message." Removing the deliveryLog entry would only make the ' +
      "record lie about what happened.",
    blastRadius: netDeltas(observedDeltas),
  };
}

export const notificationDomain: DomainAdapter<NotificationCampaignState> = { project, applyReal, proposeRollback };
