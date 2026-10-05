import type { CampaignInput } from "@/lib/marketing/campaign-service";
import { dateOrNull } from "@/lib/marketing/route-utils";

// Field-by-field copy from a request body (never `...body`): unknown keys are dropped, so a client cannot set status,
// approver, spend or any other server-owned column (mass-assignment safe).
export function campaignInputFromBody(b: Record<string, unknown>): Partial<CampaignInput> {
  const out: Partial<CampaignInput> = {};
  const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : undefined);
  const n = (k: string) => (typeof b[k] === "number" ? (b[k] as number) : undefined);
  const nullable = <T,>(k: string): T | null | undefined => (b[k] === undefined ? undefined : ((b[k] as T | null) ?? null));
  if (s("name") !== undefined) out.name = s("name");
  if (b.description !== undefined) out.description = nullable<string>("description");
  if (s("objective")) out.objective = s("objective") as never;
  if (s("channel")) out.channel = s("channel") as never;
  if (s("providerKey")) out.providerKey = s("providerKey") as never;
  if (s("campaignKey") !== undefined) out.campaignKey = s("campaignKey");
  if (b.utmSource !== undefined) out.utmSource = nullable<string>("utmSource");
  if (b.utmMedium !== undefined) out.utmMedium = nullable<string>("utmMedium");
  if (b.contentIdentifier !== undefined) out.contentIdentifier = nullable<string>("contentIdentifier");
  if (s("timezone")) out.timezone = s("timezone");
  const start = dateOrNull(b, "startAt");
  if (start !== undefined) out.startAt = start;
  const end = dateOrNull(b, "endAt");
  if (end !== undefined) out.endAt = end;
  if (s("currencyCode")) out.currencyCode = s("currencyCode");
  if (n("budgetTotalMinor") !== undefined) out.budgetTotalMinor = n("budgetTotalMinor");
  if (b.budgetDailyMinor !== undefined) out.budgetDailyMinor = nullable<number>("budgetDailyMinor");
  if (b.alertThresholdPct !== undefined) out.alertThresholdPct = nullable<number>("alertThresholdPct");
  if (b.attributionModel !== undefined) out.attributionModel = nullable<"FIRST_TOUCH" | "LAST_TOUCH">("attributionModel");
  if (s("language")) out.language = s("language") as "EN" | "UR";
  if (b.landingPageId !== undefined) out.landingPageId = nullable<string>("landingPageId");
  if (b.formId !== undefined) out.formId = nullable<string>("formId");
  if (b.routingDepartmentId !== undefined) out.routingDepartmentId = nullable<string>("routingDepartmentId");
  if (b.assignedTeamId !== undefined) out.assignedTeamId = nullable<string>("assignedTeamId");
  if (b.responsibleAdminId !== undefined) out.responsibleAdminId = nullable<string>("responsibleAdminId");
  if (b.targeting !== undefined) out.targeting = b.targeting;
  if (b.notes !== undefined) out.notes = nullable<string>("notes");
  return out;
}
