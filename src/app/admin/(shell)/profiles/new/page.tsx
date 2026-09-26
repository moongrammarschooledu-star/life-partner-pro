import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateProfileWizard } from "@/components/admin/create-profile-wizard";

export default function NewProfilePage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/profiles" className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Profiles
        </Link>
        <h1 className="mt-2 font-heading text-2xl font-semibold">Add New Profile</h1>
        <p className="text-sm text-muted">Enter details for an applicant who registered in person, by phone, or through another offline channel.</p>
      </div>
      <CreateProfileWizard />
    </div>
  );
}
