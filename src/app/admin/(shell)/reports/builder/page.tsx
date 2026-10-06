import { requirePagePermission } from "@/lib/page-guard";
import { ReportBuilderClient } from "@/components/admin/analytics/screens-b";

export default async function ReportBuilderPage() {
  const user = await requirePagePermission("analytics:reports:view");
  return <ReportBuilderClient permissions={user.permissions} />;
}
