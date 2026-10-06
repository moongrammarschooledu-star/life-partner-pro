import { requirePagePermission } from "@/lib/page-guard";
import { AnalyticsHomeClient } from "@/components/admin/analytics/screens-a";

export default async function AnalyticsPage() {
  const user = await requirePagePermission("analytics:view");
  return <AnalyticsHomeClient permissions={user.permissions} />;
}
