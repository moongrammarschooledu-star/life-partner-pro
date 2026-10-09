import { requirePagePermission } from "@/lib/page-guard";
import { DisasterRecoveryClient } from "@/components/admin/soc/recovery-client";

export default async function DisasterRecoveryPage() {
  const user = await requirePagePermission("soc:dr:view");
  return <DisasterRecoveryClient permissions={user.permissions} adminId={user.id} />;
}
