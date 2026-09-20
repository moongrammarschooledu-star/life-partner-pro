import { requirePagePermission } from "@/lib/page-guard";
import { SystemConfigClient } from "@/components/admin/system/system-config-client";

export default async function SystemConfigPage() {
  const user = await requirePagePermission("system:view");
  return <SystemConfigClient permissions={user.permissions} />;
}
