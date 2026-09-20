import { requirePagePermission } from "@/lib/page-guard";
import { ReadinessClient } from "@/components/admin/system/readiness-client";

export default async function ProductionReadinessPage() {
  const user = await requirePagePermission("readiness:view");
  return <ReadinessClient canRunTests={user.permissions.includes("system:jobs:manage")} canManageReleases={user.permissions.includes("releases:manage")} />;
}
