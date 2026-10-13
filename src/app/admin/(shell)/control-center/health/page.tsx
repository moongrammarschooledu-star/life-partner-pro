import { requirePagePermission } from "@/lib/page-guard";
import { HealthClient } from "@/components/admin/platform/health-client";

export default async function PlatformHealthPage() {
  const user = await requirePagePermission("platform:health:view");
  return <HealthClient permissions={user.permissions} />;
}