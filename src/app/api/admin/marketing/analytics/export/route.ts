import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/route-guard";
import { HttpError } from "@/lib/http-error";
import { computeMarketingAnalytics } from "@/lib/marketing/analytics";
import { marketingAudit } from "@/lib/marketing/audit";
import { buildCsvSafe } from "@/lib/marketing/csv";
import { dateRange, marketingError } from "@/lib/marketing/route-utils";

// Aggregate report exports only (campaign / channel / funnel / attribution counts) — no lead rows, no contact details.
// `kind=attribution` additionally needs marketing:attribution:export. Audited; spend columns need budget visibility.
export async function GET(req: Request) {
  try {
    const admin = await requireAdmin("marketing:analytics:export");
    const q = new URL(req.url).searchParams;
    const kind = q.get("kind") ?? "campaign";
    if (!["campaign", "channel", "funnel", "attribution"].includes(kind)) throw new HttpError(400, "Unknown report kind.");
    if (kind === "attribution" && !admin.permissions.includes("marketing:attribution:export")) throw new HttpError(403, "You do not have permission to export attribution reports.");
    const range = dateRange(req.url);
    const a = await computeMarketingAnalytics({ from: range.from, to: range.to, campaignId: q.get("campaignId") });
    const budgetVisible = admin.permissions.includes("marketing:budget:view");

    let header: string[];
    let rows: unknown[][];
    if (kind === "campaign") {
      header = ["Code", "Name", "Status", "Channel", "Leads", ...(budgetVisible ? ["Verified spend (minor)", "Cost per lead (minor)"] : [])];
      rows = a.topCampaigns.map((c) => [c.code, c.name, c.status, c.channel, c.leads, ...(budgetVisible ? [c.spendVerified ? c.spendVerifiedMinor : "", c.cplMinor ?? ""] : [])]);
    } else if (kind === "channel") {
      header = ["Channel", "Leads"];
      rows = a.byChannel.map((c) => [c.channel, c.leads]);
    } else if (kind === "funnel") {
      header = ["Stage", "Value", "Source"];
      rows = a.funnel.stages.map((s) => [s.label, s.value, s.source]);
    } else {
      header = ["UTM source", "UTM medium", "Leads"];
      rows = a.bySource.map((s) => [s.source ?? "(none)", s.medium ?? "(none)", s.leads]);
    }
    const csv = buildCsvSafe(header, rows);
    await marketingAudit({ action: "MARKETING_LEAD_EXPORTED", actorId: admin.id, resource: "analytics_export", resourceId: kind, after: { rows: rows.length, campaignId: q.get("campaignId") } });
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename=marketing-${kind}.csv`, "Cache-Control": "no-store" } });
  } catch (error) {
    return marketingError(error);
  }
}
