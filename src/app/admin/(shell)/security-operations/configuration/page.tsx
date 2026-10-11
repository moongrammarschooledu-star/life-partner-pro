import { requirePagePermission } from "@/lib/page-guard";
import { ConfigClient } from "@/components/admin/soc/config-client";

export default async function ConfigPage() {
  const user = await requirePagePermission("soc:config:view");
  return <ConfigClient permissions={user.permissions} />;
}
