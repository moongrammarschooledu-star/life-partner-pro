import { requirePagePermission } from "@/lib/page-guard";
import { RestoreDrillsClient } from "@/components/admin/soc/recovery-client";

export default async function RestoreDrillsPage() {
  const user = await requirePagePermission("soc:backups:view");
  return <RestoreDrillsClient permissions={user.permissions} adminId={user.id} />;
}
