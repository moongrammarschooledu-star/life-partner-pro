import { requirePagePermission } from "@/lib/page-guard";
import { ExecutiveReportClient } from "@/components/admin/analytics/screens-a";

export default async function ExecutiveReportPage() {
  await requirePagePermission("analytics:dashboard:view");
  return <ExecutiveReportClient />;
}
