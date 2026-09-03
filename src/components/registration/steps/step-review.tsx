import { Checkbox } from "@/components/ui/form";
import Link from "next/link";
import type { WizardData } from "@/components/registration/wizard-types";

function SummaryRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-border last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

export function StepReview({
  data,
  photoFile,
  agreed,
  onAgreeChange,
  error,
}: {
  data: WizardData;
  photoFile: File | null;
  agreed: boolean;
  onAgreeChange: (v: boolean) => void;
  error?: string;
}) {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-4">
        <p className="font-medium mb-2">Basic Information</p>
        <SummaryRow label="Full Name" value={data.basic.fullName} />
        <SummaryRow label="Gender" value={data.basic.gender} />
        <SummaryRow label="Date of Birth" value={data.basic.dateOfBirth} />
        <SummaryRow label="Marital Status" value={data.basic.maritalStatus} />
        <SummaryRow label="Height" value={data.basic.heightCm ? `${data.basic.heightCm} cm` : undefined} />
        <SummaryRow label="City" value={[data.basic.area, data.basic.city].filter(Boolean).join(", ")} />
        <SummaryRow label="Country" value={data.basic.country} />
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="font-medium mb-2">Contact (private)</p>
        <SummaryRow label="Mobile" value={data.contact.mobileNumber} />
        <SummaryRow label="Email" value={data.contact.email} />
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="font-medium mb-2">Education & Profession</p>
        <SummaryRow label="Education" value={data.educationProfession.educationLevel} />
        <SummaryRow label="Profession" value={data.educationProfession.profession} />
      </div>

      <div className="rounded-lg border border-border p-4">
        <p className="font-medium mb-2">Photo</p>
        <p className="text-sm text-muted">{photoFile ? photoFile.name : "No photo uploaded"}</p>
      </div>

      <div className="rounded-lg border border-border bg-surface-muted p-4">
        <p className="font-medium mb-2">Consent</p>
        <p className="text-sm text-muted mb-3">
          I understand that my information will be stored securely and reviewed by authorized Life Partner Pro
          administrators for matrimonial matchmaking purposes. I have read the{" "}
          <Link href="/privacy-policy" target="_blank" className="text-primary underline">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" target="_blank" className="text-primary underline">
            Terms &amp; Conditions
          </Link>
          .
        </p>
        <Checkbox label="I Agree" checked={agreed} onChange={(e) => onAgreeChange(e.target.checked)} />
        {error && <p className="text-xs text-danger mt-2">{error}</p>}
      </div>
    </div>
  );
}
