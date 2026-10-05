import Link from "next/link";
import { requirePagePermission } from "@/lib/page-guard";
import { ApplicantEngagementPanel } from "@/components/admin/engagement/applicant-engagement-panel";

// Admin -> one applicant's engagement view. The API enforces the same assignment rule as other staff profile screens.
export default async function EngagementUserPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("engagement:events:view");
  const { id } = await params;
  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/engagement" className="text-sm text-primary hover:underline">← Engagement Center</Link>
        <h1 className="mt-1 text-xl font-semibold">Applicant engagement</h1>
      </div>
      <ApplicantEngagementPanel profileId={id} canManage={user.permissions.includes("engagement:reminders:manage")} />
    </div>
  );
}
