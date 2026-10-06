import { requirePagePermission } from "@/lib/page-guard";
import { DashboardBuilderClient } from "@/components/admin/analytics/screens-b";

export default async function BuilderPage() {
  const user = await requirePagePermission("analytics:dashboard:view");
  return <DashboardBuilderClient permissions={user.permissions} />;
}
