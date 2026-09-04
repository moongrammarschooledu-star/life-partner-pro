import Link from "next/link";
import { Checkbox } from "@/components/ui/form";
import { Pencil } from "lucide-react";
import type { WizardData } from "@/components/registration/wizard-types";
import { useRegistrationLocale } from "@/components/registration/locale-context";
import { computeCompletion } from "@/lib/profile-completion";

function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 5) return "*".repeat(digits.length);
  return `${digits.slice(0, 2)}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-2)}`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  return `${local[0] ?? ""}${"*".repeat(Math.max(1, local.length - 1))}@${domain}`;
}

function SummaryRow({ label, value }: { label: string; value?: string | number | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-border last:border-0">
      <span className="text-muted">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function SectionCard({ title, step, onEdit, children }: { title: string; step: number; onEdit: (step: number) => void; children: React.ReactNode }) {
  const { t } = useRegistrationLocale();
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-medium">{title}</p>
        <button type="button" onClick={() => onEdit(step)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
          <Pencil className="h-3 w-3" /> {t("edit")}
        </button>
      </div>
      {children}
    </div>
  );
}

export function StepReview({
  data,
  photoFile,
  onConsentChange,
  errors,
  onEditStep,
}: {
  data: WizardData;
  photoFile: File | null;
  onConsentChange: <K extends keyof WizardData["consent"]>(field: K, value: WizardData["consent"][K]) => void;
  errors: Record<string, string>;
  onEditStep: (step: number) => void;
}) {
  const { t } = useRegistrationLocale();
  const { percent, suggestions } = computeCompletion({
    hasPhoto: !!photoFile,
    area: data.basic.area,
    nationality: data.basic.nationality,
    degree: data.educationProfession.degree,
    institution: data.educationProfession.institution,
    familyBackground: data.family.familyBackground,
    aboutMe: data.lifestyle.aboutMe,
    hobbies: data.lifestyle.hobbies,
    personality: data.lifestyle.personality,
    religion: data.lifestyle.religion,
  });

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-medium">{t("profileCompletion")}</p>
          <span className="text-sm font-semibold text-primary">{percent}%</span>
        </div>
        <div className="h-2.5 rounded-full bg-surface-muted">
          <div className="h-2.5 rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        {suggestions.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {suggestions.map((s) => (
              <li key={s}>• {s}</li>
            ))}
          </ul>
        )}
      </div>

      <SectionCard title={t("personalInformation")} step={0} onEdit={onEditStep}>
        <SummaryRow label={t("fullName")} value={data.basic.fullName} />
        <SummaryRow label={t("gender")} value={data.basic.gender} />
        <SummaryRow label={t("age")} value={data.basic.dateOfBirth} />
        <SummaryRow label={t("maritalStatus")} value={data.basic.maritalStatus} />
        <SummaryRow label={t("height")} value={data.basic.heightCm ? `${data.basic.heightCm} cm` : undefined} />
        <SummaryRow label={t("city")} value={[data.basic.area, data.basic.city].filter(Boolean).join(", ")} />
        <SummaryRow label={t("country")} value={data.basic.country} />
      </SectionCard>

      <SectionCard title={t("contactInformation")} step={1} onEdit={onEditStep}>
        <SummaryRow label={t("mobileNumber")} value={data.contact.mobileNumber ? maskPhone(data.contact.mobileNumber) : undefined} />
        <SummaryRow label={t("email")} value={data.contact.email ? maskEmail(data.contact.email) : undefined} />
      </SectionCard>

      <SectionCard title={t("educationCareer")} step={2} onEdit={onEditStep}>
        <SummaryRow label={t("educationLevel")} value={data.educationProfession.educationLevel} />
        <SummaryRow label={t("profession")} value={data.educationProfession.profession} />
        <SummaryRow label={t("adminOnlyIncome")} value={data.educationProfession.monthlyIncome ? "🔒 Private" : undefined} />
      </SectionCard>

      <SectionCard title={t("familyInformation")} step={3} onEdit={onEditStep}>
        <SummaryRow label={t("familyType")} value={data.family.familyType} />
        <SummaryRow label={t("familyStatus")} value={data.family.familyStatus} />
      </SectionCard>

      <SectionCard title={t("lifestyle")} step={4} onEdit={onEditStep}>
        <SummaryRow label={t("languages")} value={data.lifestyle.languages} />
        <SummaryRow label={t("religion")} value={data.lifestyle.religion} />
      </SectionCard>

      <SectionCard title={t("partnerRequirements")} step={5} onEdit={onEditStep}>
        <SummaryRow
          label={t("agePreference")}
          value={data.preference.minAge || data.preference.maxAge ? `${data.preference.minAge || "?"}–${data.preference.maxAge || "?"}` : undefined}
        />
        <SummaryRow label={t("professionPreference")} value={data.preference.professionPreference} />
      </SectionCard>

      <SectionCard title={t("photo")} step={6} onEdit={onEditStep}>
        <p className="text-sm text-muted">{photoFile ? photoFile.name : "No photo uploaded"}</p>
      </SectionCard>

      <div className="rounded-lg border border-border bg-surface-muted p-4">
        <p className="font-medium mb-2">{t("consentTitle")}</p>
        <div className="space-y-2.5">
          <div>
            <Checkbox label={t("consentAccurate")} checked={data.consent.accurate} onChange={(e) => onConsentChange("accurate", e.target.checked)} />
            {errors.accurate && <p className="ml-6 text-xs text-danger">{errors.accurate}</p>}
          </div>
          <div>
            <Checkbox
              label={t("consentStorage")}
              checked={data.consent.storageConsent}
              onChange={(e) => onConsentChange("storageConsent", e.target.checked)}
            />
            {errors.storageConsent && <p className="ml-6 text-xs text-danger">{errors.storageConsent}</p>}
          </div>
          <div>
            <Checkbox
              label={t("consentReview")}
              checked={data.consent.reviewConsent}
              onChange={(e) => onConsentChange("reviewConsent", e.target.checked)}
            />
            {errors.reviewConsent && <p className="ml-6 text-xs text-danger">{errors.reviewConsent}</p>}
          </div>
          <Checkbox
            label={t("consentContact")}
            checked={data.consent.contactConsent}
            onChange={(e) => onConsentChange("contactConsent", e.target.checked)}
          />
        </div>
        <p className="mt-3 text-xs text-muted">
          <Link href="/privacy-policy" target="_blank" className="text-primary underline">
            {t("privacyPolicy")}
          </Link>{" "}
          ·{" "}
          <Link href="/terms" target="_blank" className="text-primary underline">
            {t("termsConditions")}
          </Link>{" "}
          ·{" "}
          <Link href="/privacy-policy" target="_blank" className="text-primary underline">
            {t("dataPolicy")}
          </Link>
        </p>
      </div>
    </div>
  );
}
