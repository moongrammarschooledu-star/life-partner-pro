import { requirePagePermission } from "@/lib/page-guard";
import { IncidentsClient } from "@/components/admin/soc/incidents-client";

export default async function IncidentsPage() {
  const user = await requirePagePermission("soc:incidents:view");
  return <IncidentsClient permissions={user.permissions} />;
}
