import { requirePagePermission } from "@/lib/page-guard";
import { DocumentDetailClient } from "@/components/admin/documents/documents-client";

export default async function DocumentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("documents:view");
  const { id } = await params;
  return <DocumentDetailClient id={id} permissions={user.permissions} />;
}
