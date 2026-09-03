import { ProfileDetailClient } from "@/components/admin/profile-detail/profile-detail-client";

export default async function ProfileDetailPage({ params }: PageProps<"/admin/profiles/[id]">) {
  const { id } = await params;
  return <ProfileDetailClient profileId={id} />;
}
