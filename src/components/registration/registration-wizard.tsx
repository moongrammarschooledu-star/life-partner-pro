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
import type { ZodError } from "zod";

function zodErrorsToMap(error: ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    map[String(issue.path[0])] = issue.message;
  }
  return map;
}

export function RegistrationWizard() {
  const router = useRouter();
  const { show } = useToast();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(initialWizardData);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  function updateSection<S extends keyof WizardData>(section: S, field: keyof WizardData[S], value: unknown) {
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
    if (step === 7 && !data.consent.agreed) {
      setErrors({ agreed: "You must agree before submitting" });
      return false;
    }
    return true;
  }

  function next() {
    if (!validateStep()) {
      show("Please check the highlighted fields before continuing.", "error");
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

      const res = await fetch("/api/register", { method: "POST", body: formData });
      const json = await res.json();

      if (!res.ok) {
        show(json.error ?? "Your profile could not be submitted. Please check the highlighted fields.", "error");
        return;
      }

      router.push(`/register/confirmation?code=${encodeURIComponent(json.profileCode)}`);
    } catch {
      show("Something went wrong. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
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
            agreed={data.consent.agreed}
            onAgreeChange={(v) => updateSection("consent", "agreed", v)}
            error={errors.agreed}
          />
        )}
      </div>

      <div className="mt-8 flex justify-between">
        <Button variant="outline" onClick={back} disabled={step === 0}>
          <ChevronLeft className="h-4 w-4" /> Back
        </Button>
        {step < STEP_TITLES.length - 1 ? (
          <Button onClick={next}>
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Submit Profile
          </Button>
        )}
      </div>
    </div>
  );
}
