import { requirePagePermission } from "@/lib/page-guard";
import { IncidentDetailClient } from "@/components/admin/soc/incidents-client";

export default async function IncidentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("soc:incidents:view");
  const { id } = await params;
  return <IncidentDetailClient id={id} permissions={user.permissions} adminId={user.id} />;
}
