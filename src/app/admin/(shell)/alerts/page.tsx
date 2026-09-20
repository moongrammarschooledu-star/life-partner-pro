import { requirePagePermission } from "@/lib/page-guard";
import { AlertsClient } from "@/components/admin/system/alerts-client";

export default async function AlertsPage() {
  const user = await requirePagePermission("alerts:view");
  return <AlertsClient canManage={user.permissions.includes("alerts:manage")} />;
}
