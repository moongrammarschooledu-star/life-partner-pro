import { requirePagePermission } from "@/lib/page-guard";
import { DocumentsClient } from "@/components/admin/documents/documents-client";

export default async function DocumentsPage() {
  const user = await requirePagePermission("documents:view");
  return <DocumentsClient permissions={user.permissions} />;
}
