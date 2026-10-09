import { requirePagePermission } from "@/lib/page-guard";
import { OverviewClient } from "@/components/admin/soc/overview-client";

export default async function OverviewPage() {
  const user = await requirePagePermission("soc:view");
  return <OverviewClient permissions={user.permissions} />;
}
