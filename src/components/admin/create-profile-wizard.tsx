"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StepIndicator } from "@/components/registration/step-indicator";
import { StepBasic } from "@/components/registration/steps/step-basic";
import { StepContact } from "@/components/registration/steps/step-contact";
import { StepEducationProfession } from "@/components/registration/steps/step-education-profession";
import { StepFamily } from "@/components/registration/steps/step-family";
import { StepLifestyle } from "@/components/registration/steps/step-lifestyle";
import { StepPreference } from "@/components/registration/steps/step-preference";
import { StepPhoto } from "@/components/registration/steps/step-photo";
import { StepReview } from "@/components/registration/steps/step-review";
import { initialWizardData, STEP_TITLES, type WizardData } from "@/components/registration/wizard-types";
import {
  basicInfoSchema,
  contactInfoSchema,
  educationProfessionSchema,
  familyInfoSchema,
  partnerPreferenceSchema,
} from "@/lib/validation/registration";
import { useToast } from "@/components/ui/toast";
import { RegistrationLocaleProvider } from "@/components/registration/locale-context";
import type { ZodError } from "zod";

function zodErrorsToMap(error: ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    map[String(issue.path[0])] = issue.message;
  }
  return map;
}

// Admin-side counterpart of RegistrationWizard (src/components/registration/registration-wizard.tsx)
// for staff entering a walk-in / phone-in applicant's details directly. Reuses
// the exact same step components and section schemas as the public wizard —
// same fields, same validation, same 8-step shape — so the two never drift
// apart. Deliberately drops what only makes sense for an unauthenticated,
// unattended public submission: no honeypot (the submitter is an
// authenticated admin), no localStorage draft-recovery/autosave (an admin
// session isn't at risk of an anonymous tab being closed mid-fill the way a
// public visitor's is). Posts to POST /api/admin/profiles instead of
// /api/register and lands on the new profile's admin detail page instead of
// the public confirmation page.
function WizardBody() {
  const router = useRouter();
  const { show } = useToast();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(initialWizardData);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function updateSection<S extends Exclude<keyof WizardData, "hp">>(section: S, field: keyof WizardData[S], value: unknown) {
    setData((prev) => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  }

  function validateStep(): boolean {
    setErrors({});
    if (step === 0) {
      const result = basicInfoSchema.safeParse(data.basic);
      if (!result.success) return (setErrors(zodErrorsToMap(result.error)), false);
    }
    if (step === 1) {
      const result = contactInfoSchema.safeParse(data.contact);
      if (!result.success) return (setErrors(zodErrorsToMap(result.error)), false);
    }
    if (step === 2) {
      const result = educationProfessionSchema.safeParse(data.educationProfession);
      if (!result.success) return (setErrors(zodErrorsToMap(result.error)), false);
    }
    if (step === 3) {
      const result = familyInfoSchema.safeParse(data.family);
      if (!result.success) return (setErrors(zodErrorsToMap(result.error)), false);
    }
    if (step === 5) {
      const result = partnerPreferenceSchema.safeParse(data.preference);
      if (!result.success) return (setErrors(zodErrorsToMap(result.error)), false);
    }
    if (step === 7) {
      const newErrors: Record<string, string> = {};
      if (!data.consent.accurate) newErrors.accurate = "Required";
      if (!data.consent.storageConsent) newErrors.storageConsent = "Required";
      if (!data.consent.reviewConsent) newErrors.reviewConsent = "Required";
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return false;
      }
    }
    return true;
  }

  function next() {
    if (!validateStep()) {
      show("Please check the highlighted fields.", "error");
      return;
    }
    setStep((s) => Math.min(s + 1, STEP_TITLES.length - 1));
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 0));
  }

  async function submit() {
    if (!validateStep()) return;
    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("payload", JSON.stringify(data));
      if (photoFile) formData.append("photo", photoFile);

      const res = await fetch("/api/admin/profiles", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok) {
        show(json.error ?? "This profile could not be created. Please check the highlighted fields.", "error");
        return;
      }

      show(`Profile ${json.profileCode} created`, "success");
      router.push(`/admin/profiles/${json.id}`);
    } catch {
      show("Something went wrong. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <StepIndicator current={step} total={STEP_TITLES.length} titles={STEP_TITLES} />

      <div className="mt-8">
        {step === 0 && <StepBasic data={data.basic} errors={errors} onChange={(f, v) => updateSection("basic", f, v)} />}
        {step === 1 && <StepContact data={data.contact} errors={errors} onChange={(f, v) => updateSection("contact", f, v)} />}
        {step === 2 && (
          <StepEducationProfession
            data={data.educationProfession}
            errors={errors}
            onChange={(f, v) => updateSection("educationProfession", f, v)}
          />
        )}
        {step === 3 && <StepFamily data={data.family} onChange={(f, v) => updateSection("family", f, v)} />}
        {step === 4 && <StepLifestyle data={data.lifestyle} errors={errors} onChange={(f, v) => updateSection("lifestyle", f, v)} />}
        {step === 5 && <StepPreference data={data.preference} errors={errors} onChange={(f, v) => updateSection("preference", f, v)} />}
        {step === 6 && <StepPhoto onChange={setPhotoFile} error={errors.photo} />}
        {step === 7 && (
          <StepReview
            data={data}
            photoFile={photoFile}
            onConsentChange={(f, v) => updateSection("consent", f, v)}
            errors={errors}
            onEditStep={setStep}
            contextNote="You are creating this profile on behalf of the applicant. Only continue if they have already agreed to the following, in person or over the phone."
          />
        )}
      </div>

      <div className="mt-8 flex items-center justify-between gap-2">
        <Button variant="outline" onClick={back} disabled={step === 0}>
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {step < STEP_TITLES.length - 1 ? (
          <Button onClick={next}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create Profile
          </Button>
        )}
      </div>
    </div>
  );
}

export function CreateProfileWizard() {
  return (
    <RegistrationLocaleProvider>
      <WizardBody />
    </RegistrationLocaleProvider>
  );
}
