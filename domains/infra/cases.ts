import { makeWorld } from "../../lib/contracts/index.js";
import type { DomainCase } from "../types.js";
import { infraDomain, type InfraResourceState } from "./domain.js";

/** I1 — `m6-domain-cases.md` §4. `Reconciliation.confirmed`, an unused, genuinely multi-step `Rollback.runnable`. */

const i1World = makeWorld<InfraResourceState>({
  id: "svc-checkout-api",
  domain: "infra",
  version: 1,
  at: "2026-09-20T13:00:00Z",
  data: {
    resourceId: "svc-checkout-api",
    instanceType: "m6i.2xlarge",
    desiredCount: 8,
    provisioningState: "steady",
    monthlyCostUsd: 6400,
  },
});

export const infraI1: DomainCase<InfraResourceState> = {
  id: "infra-i1-downsize-clean",
  domainName: "infra",
  title: "I1 — rightsize svc-checkout-api from m6i.2xlarge to m6i.large",
  narrative: "svc-checkout-api is over-provisioned after a traffic-pattern review; ops rightsizes it.",
  adapter: infraDomain,
  action: {
    domain: "infra",
    type: "resize",
    params: { resourceId: "svc-checkout-api", targetInstanceType: "m6i.large", targetMonthlyCostUsd: 1600 },
  },
  initialWorld: i1World,
  expectedReconciliationStatus: "confirmed",
  expectedRollbackKind: "runnable",
  rollbackPolicy: "unused",
};

export const infraCases: ReadonlyArray<DomainCase<InfraResourceState>> = [infraI1];
