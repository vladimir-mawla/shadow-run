import { makeWorld } from "../../lib/contracts/index.js";
import type { DomainCase } from "../types.js";
import { calendarDomain, type CalendarEventState } from "./domain.js";

/**
 * C1/C2 — `m6-domain-cases.md` §1. Both `Reconciliation.confirmed` and an
 * unused `Rollback.runnable`, per that document's own framing: "if this
 * domain ever shows anything other than confirmed + an unused runnable
 * rollback, the bug is in the engine, not in reality." World JSON and
 * action params are copied verbatim from the design doc; fingerprints are
 * re-verified against the real `computeFingerprint`, not trusted, in
 * `domains/__tests__/fingerprints.test.ts` — see
 * `.genesis/decisions/0005-domains.md` for which of the design doc's
 * claimed fingerprints held up and which did not (the `Delta` SHAPES
 * differ from the doc's literal element-level examples — see
 * `domain.ts`'s header — but every quoted `World.data` JSON payload and
 * its resulting fingerprint is independent of how the delta that produced
 * it is represented, so those numbers are checked as-is).
 */

const c1World = makeWorld<CalendarEventState>({
  id: "cal-evt-7f3a",
  domain: "calendar",
  version: 4,
  at: "2026-09-20T14:00:00Z",
  data: {
    eventId: "cal-evt-7f3a",
    title: "Q3 Roadmap Review",
    organizer: "vladimir.mawla@aspiresoftware.com",
    attendees: ["jordan.li@aspiresoftware.com", "priya.shah@aspiresoftware.com"],
    startAt: "2026-09-22T15:00:00Z",
    endAt: "2026-09-22T16:00:00Z",
    room: "SF-9C-Aurora",
    status: "confirmed",
  },
});

export const calendarC1: DomainCase<CalendarEventState> = {
  id: "cal-c1-reschedule-clean",
  domainName: "calendar",
  title: "C1 — reschedule the Q3 Roadmap Review, nobody else touches it",
  narrative:
    "Vladimir pushes the Q3 Roadmap Review two hours after a room conflict; nobody else touches this event in the window.",
  adapter: calendarDomain,
  action: {
    domain: "calendar",
    type: "reschedule",
    params: { eventId: "cal-evt-7f3a", newStartAt: "2026-09-22T17:00:00Z", newEndAt: "2026-09-22T18:00:00Z" },
  },
  initialWorld: c1World,
  expectedReconciliationStatus: "confirmed",
  expectedRollbackKind: "runnable",
  rollbackPolicy: "unused",
};

// C1's real post-state, chained into C2 exactly as the design doc does
// ("Chained on C1's post-state... a reader can see that pairing in
// isolation before meeting it again in the inventory demo") — built by
// literally running C1's own real execution rather than re-typing its
// JSON a second time, so a change to C1's action/world above can never
// silently drift out of sync with C2's starting point.
const c1Real = calendarDomain.applyReal(calendarC1.action, c1World).world;
const c2World = makeWorld<CalendarEventState>({
  id: c1Real.id,
  domain: c1Real.domain,
  version: 5,
  at: "2026-09-20T14:05:00Z",
  data: c1Real.data,
});

export const calendarC2: DomainCase<CalendarEventState> = {
  id: "cal-c2-add-attendee-clean",
  domainName: "calendar",
  title: "C2 — loop in a fourth attendee before the (now-rescheduled) meeting",
  narrative: "Chained on C1's post-state, Vladimir loops in a fourth attendee before the rescheduled meeting.",
  adapter: calendarDomain,
  action: {
    domain: "calendar",
    type: "addAttendee",
    params: { eventId: "cal-evt-7f3a", attendeeEmail: "morgan.reyes@aspiresoftware.com" },
  },
  initialWorld: c2World,
  expectedReconciliationStatus: "confirmed",
  expectedRollbackKind: "runnable",
  rollbackPolicy: "unused",
};

export const calendarCases: ReadonlyArray<DomainCase<CalendarEventState>> = [calendarC1, calendarC2];
