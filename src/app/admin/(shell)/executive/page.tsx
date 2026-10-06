import { requirePagePermission } from "@/lib/page-guard";
import { ExecutiveClient } from "@/components/admin/analytics/screens-a";

// Admin -> Executive dashboard. A shell only: the API filters every figure to what the viewer may see.
export default async function ExecutivePage() {
  const user = await requirePagePermission("analytics:dashboard:view");
  return <ExecutiveClient canSummary={user.permissions.includes("ai:analytics:use")} />;
}
