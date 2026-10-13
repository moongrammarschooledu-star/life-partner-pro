"use client";

import { computeCompletion } from "@/lib/profile-completion";
import { useRegistrationLocale } from "@/components/registration/locale-context";
import type { WizardData } from "@/components/registration/wizard-types";

// Live profile completion while the form is being filled (it used to appear only on the last step). It reuses the existing wizard estimator
// (lib/profile-completion.ts, the same one the review step shows), so there is one scoring rule, not two.
const LABEL = { en: "Profile completion", ur: "پروفائل کی تکمیل" } as const;
const HINT = {
  en: "Optional details raise this. Required steps are what you need to submit.",
  ur: "اختیاری تفصیلات اسے بڑھاتی ہیں۔ جمع کروانے کے لیے صرف ضروری مراحل درکار ہیں۔",
} as const;

export function RegistrationProgress({ data, hasPhoto }: { data: WizardData; hasPhoto: boolean }) {
  const { locale } = useRegistrationLocale();
  const { percent } = computeCompletion({
    hasPhoto,
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
    <div className="mt-4" role="group" aria-label={LABEL[locale]}>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium">{LABEL[locale]}</span>
        <span className="font-semibold text-primary">{percent}%</span>
      </div>
      <div className="h-2 rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={LABEL[locale]}>
        <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{HINT[locale]}</p>
    </div>
  );
}
