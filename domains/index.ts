export type { AppliedReal, DomainAdapter, DomainCase, RollbackPolicy } from "./types.js";
export { netDeltas } from "./shared/net.js";

export { calendarDomain, type CalendarEventState } from "./calendar/domain.js";
export { calendarCases, calendarC1, calendarC2 } from "./calendar/cases.js";

export { inventoryDomain, type StockState } from "./inventory/domain.js";
export { inventoryCases, inventoryInv1, inventoryInv2, inventoryInv3 } from "./inventory/cases.js";

export { notificationDomain, type NotificationCampaignState } from "./notification/domain.js";
export { notificationCases, notificationN1 } from "./notification/cases.js";

export { infraDomain, type InfraResourceState } from "./infra/domain.js";
export { infraCases, infraI1 } from "./infra/cases.js";

import type { DomainCase } from "./types.js";
import { calendarCases } from "./calendar/cases.js";
import { inventoryCases } from "./inventory/cases.js";
import { notificationCases } from "./notification/cases.js";
import { infraCases } from "./infra/cases.js";

/**
 * All seven cases across all four domains, in the order
 * `m6-domain-cases.md` presents them — the single list
 * `scripts/demo-domains.ts` iterates, and the single list
 * `domains/__tests__/*.test.ts` checks coverage against.
 */
// `DomainCase<any>` is a deliberate, explicit widening (not an accidental implicit `any` — `strict` mode
// still requires writing it out): each domain's own cases are correctly typed to their own `TState`
// (`CalendarEventState`, `StockState`, ...), and this array exists only to be iterated GENERICALLY by the
// demo script and by `domains/__tests__/coverage.test.ts` — nothing here calls a specific domain's
// TState-typed `project`/`applyReal` off this list without going through `case.adapter` itself, which
// stays correctly typed at its own definition site.
export const ALL_CASES: ReadonlyArray<DomainCase<any>> = [...calendarCases, ...inventoryCases, ...notificationCases, ...infraCases];
