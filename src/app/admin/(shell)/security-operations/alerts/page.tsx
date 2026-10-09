import { requirePagePermission } from "@/lib/page-guard";
import { AlertsClient } from "@/components/admin/soc/alerts-client";

export default async function AlertsPage() {
  const user = await requirePagePermission("soc:alerts:view");
  return <AlertsClient permissions={user.permissions} adminId={user.id} />;
}
