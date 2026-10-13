import { requirePagePermission } from "@/lib/page-guard";
import { ContentEditorClient } from "@/components/admin/content/content-editor";

export default async function ContentEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("content:view");
  const { id } = await params;
  return <ContentEditorClient id={id} permissions={user.permissions} />;
}
