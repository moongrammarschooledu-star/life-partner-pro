import { requirePagePermission } from "@/lib/page-guard";
import { DeploymentClient } from "@/components/admin/platform/deployment-client";

export default async function PlatformDeploymentPage() {
  const user = await requirePagePermission("platform:deployment:view");
  return <DeploymentClient permissions={user.permissions} />;
}