import { requirePagePermission } from "@/lib/page-guard";
import { currentEnvironment } from "@/lib/platform/environment";
import { HistoryClient } from "@/components/admin/platform/history-client";

export default async function ConfigurationHistoryPage() {
  const user = await requirePagePermission("platform:configuration:view");
  return <HistoryClient permissions={user.permissions} environment={currentEnvironment()} />;
}