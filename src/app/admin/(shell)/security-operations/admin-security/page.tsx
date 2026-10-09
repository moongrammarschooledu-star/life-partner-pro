import { requirePagePermission } from "@/lib/page-guard";
import { AdminSecurityClient } from "@/components/admin/soc/admin-security-client";

export default async function AdminSecurityPage() {
  const user = await requirePagePermission("soc:admin_security:view");
  return <AdminSecurityClient permissions={user.permissions} />;
}
