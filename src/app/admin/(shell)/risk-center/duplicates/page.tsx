import { requirePagePermission } from "@/lib/page-guard";
import { RiskDuplicatesClient } from "@/components/admin/risk/risk-duplicates-client";

export default async function RiskDuplicatesPage() {
  const user = await requirePagePermission("duplicates:view");
  return <RiskDuplicatesClient permissions={user.permissions} />;
}
