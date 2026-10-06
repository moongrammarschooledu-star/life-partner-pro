import { requirePagePermission } from "@/lib/page-guard";
import { CohortsClient } from "@/components/admin/analytics/screens-a";

export default async function CohortsPage() {
  await requirePagePermission("analytics:view");
  return <CohortsClient />;
}
