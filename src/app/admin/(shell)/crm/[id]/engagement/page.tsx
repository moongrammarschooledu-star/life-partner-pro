import { redirect } from "next/navigation";

// /admin/crm/:id/engagement opens the Engagement tab of the CRM record (the tab does the permission-checked work).
export default async function CrmEngagementRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/admin/crm/${id}?tab=engagement`);
}
