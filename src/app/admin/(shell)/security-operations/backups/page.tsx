import { requirePagePermission } from "@/lib/page-guard";
import { BackupsClient } from "@/components/admin/soc/recovery-client";

export default async function BackupsPage() {
  const user = await requirePagePermission("soc:backups:view");
  return <BackupsClient permissions={user.permissions} />;
}
