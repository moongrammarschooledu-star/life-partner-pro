import { requirePagePermission } from "@/lib/page-guard";
import { GovernanceClient } from "@/components/admin/analytics/screens-b";

export default async function GovernancePage() {
  const user = await requirePagePermission("analytics:view");
  return <GovernanceClient permissions={user.permissions} />;
}
