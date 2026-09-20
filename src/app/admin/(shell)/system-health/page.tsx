import { requirePagePermission } from "@/lib/page-guard";
import { SystemHealthClient } from "@/components/admin/system/system-health-client";

export default async function SystemHealthPage() {
  const user = await requirePagePermission("system:view");
  return <SystemHealthClient permissions={user.permissions} adminId={user.id} />;
}
