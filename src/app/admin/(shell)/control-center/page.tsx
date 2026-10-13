import { requirePagePermission } from "@/lib/page-guard";
import { ControlCenterOverview } from "@/components/admin/platform/overview-client";

export default async function ControlCenterPage() {
  const user = await requirePagePermission("platform:control_center:view");
  return <ControlCenterOverview permissions={user.permissions} />;
}