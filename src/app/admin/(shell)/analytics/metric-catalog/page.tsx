import { requirePagePermission } from "@/lib/page-guard";
import { CatalogClient } from "@/components/admin/analytics/screens-b";

export default async function MetricCatalogPage() {
  const user = await requirePagePermission("analytics:metrics:view");
  return <CatalogClient permissions={user.permissions} />;
}
