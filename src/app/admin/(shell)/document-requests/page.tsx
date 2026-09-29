import { requirePagePermission } from "@/lib/page-guard";
import { DocumentRequestsClient } from "@/components/admin/documents/document-requests-client";

export default async function DocumentRequestsPage() {
  const user = await requirePagePermission("documents:manage_requests");
  return <DocumentRequestsClient canManage={user.permissions.includes("documents:manage_requests")} />;
}
