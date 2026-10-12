import { requirePagePermission } from "@/lib/page-guard";
import { DeploymentClient } from "@/components/admin/system/deployment-client";

export default async function DeploymentPage() {
  const user = await requirePagePermission("readiness:view");
  return <DeploymentClient canManage={user.permissions.includes("golive:manage")} />;
}
