import { makeWorld } from "../../lib/contracts/index.js";
import type { DomainCase } from "../types.js";
import { notificationDomain, type NotificationCampaignState } from "./domain.js";

/** N1 — `m6-domain-cases.md` §3. `Reconciliation.confirmed`, `Rollback.unavailable`. */

const n1World = makeWorld<NotificationCampaignState>({
  id: "camp-2201",
  domain: "notification",
  version: 1,
  at: "2026-09-20T14:09:00Z",
  data: {
    campaignId: "camp-2201",
    template: "invoice-overdue-reminder",
    recipient: "customer-48213@example.com",
    outbox: [],
    deliveryLog: [],
  },
});

export const notificationN1: DomainCase<NotificationCampaignState> = {
  id: "notif-n1-send-unavailable",
  domainName: "notification",
  title: "N1 — an overdue-invoice reminder goes out, sent, confirmed, rollback unavailable",
  narrative: "An overdue-invoice reminder goes out to a customer.",
  adapter: notificationDomain,
  action: {
    domain: "notification",
    type: "send",
    params: {
      campaignId: "camp-2201",
      recipient: "customer-48213@example.com",
      messageId: "msg-77c1",
      sentAt: "2026-09-20T14:10:00Z",
    },
  },
  initialWorld: n1World,
  expectedReconciliationStatus: "confirmed",
  expectedRollbackKind: "unavailable",
  rollbackPolicy: "not-applicable",
};

export const notificationCases: ReadonlyArray<DomainCase<NotificationCampaignState>> = [notificationN1];
