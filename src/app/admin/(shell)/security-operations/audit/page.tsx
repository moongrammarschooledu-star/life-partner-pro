import { requirePagePermission } from "@/lib/page-guard";
import { AuditClient } from "@/components/admin/soc/config-client";

export default async function AuditPage() {
  const user = await requirePagePermission("soc:audit:view");
  return <AuditClient permissions={user.permissions} />;
}
