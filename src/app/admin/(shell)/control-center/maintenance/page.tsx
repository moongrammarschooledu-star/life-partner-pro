import { requirePagePermission } from "@/lib/page-guard";
import { MaintenanceClient } from "@/components/admin/platform/maintenance-client";

export default async function MaintenancePage() {
  const user = await requirePagePermission("platform:maintenance:view");
  return <MaintenanceClient permissions={user.permissions} />;
}