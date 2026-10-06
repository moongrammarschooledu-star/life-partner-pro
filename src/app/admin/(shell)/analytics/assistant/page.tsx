import { requirePagePermission } from "@/lib/page-guard";
import { AssistantClient } from "@/components/admin/analytics/screens-a";

export default async function AssistantPage() {
  await requirePagePermission("ai:analytics:use");
  return <AssistantClient />;
}
