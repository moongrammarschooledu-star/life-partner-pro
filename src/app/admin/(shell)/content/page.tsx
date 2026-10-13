import { requirePagePermission } from "@/lib/page-guard";
import { ContentListClient } from "@/components/admin/content/content-list";

export default async function ContentPage() {
  const user = await requirePagePermission("content:view");
  return <ContentListClient permissions={user.permissions} />;
}
