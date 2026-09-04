"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Loader2, Save } from "lucide-react";
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
import { RegistrationLocaleProvider, LocaleToggle, useRegistrationLocale } from "@/components/registration/locale-context";
import type { ZodError } from "zod";

const DRAFT_KEY = "lpp_registration_draft";

function zodErrorsToMap(error: ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) {
    map[String(issue.path[0])] = issue.message;
  }
  return map;
}

function loadDraft(): { data: WizardData; step: number; savedAt: number } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function timeAgo(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "moments ago";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} day(s) ago`;
}

function WizardBody() {
  const router = useRouter();
  const { show } = useToast();
  const { t, locale } = useRegistrationLocale();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(initialWizardData);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [draftBanner, setDraftBanner] = useState<{ savedAt: number } | null>(null);

  // Draft recovery — offer to resume before touching any wizard state.
  useEffect(() => {
    const draft = loadDraft();
    if (draft) setDraftBanner({ savedAt: draft.savedAt });
  }, []);

  // Silent autosave — survives an accidental refresh/close (spec §20).
  useEffect(() => {
    if (draftBanner) return; // don't overwrite the draft before the user decides
    const handle = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ data, step, savedAt: Date.now() }));
      } catch {
        // storage unavailable — autosave silently skipped
      }
    }, 600);
    return () => clearTimeout(handle);
  }, [data, step, draftBanner]);

  function resumeDraft() {
    const draft = loadDraft();
    if (draft) {
      setData(draft.data);
      setStep(draft.step);
    }
    setDraftBanner(null);
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    setDraftBanner(null);
  }

  function saveDraftNow() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ data, step, savedAt: Date.now() }));
      show(t("draftSaved"), "success");
    } catch {
      show("Could not save draft on this device.", "error");
    }
  }

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
      if (!data.consent.accurate) newErrors.accurate = t("errorConsent");
      if (!data.consent.storageConsent) newErrors.storageConsent = t("errorConsent");
      if (!data.consent.reviewConsent) newErrors.reviewConsent = t("errorConsent");
      if (Object.keys(newErrors).length > 0) {
        setErrors(newErrors);
        return false;
      }
    }
    return true;
  }

  function next() {
    if (!validateStep()) {
      show(t("checkFields"), "error");
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

      localStorage.removeItem(DRAFT_KEY);
      router.push(`/register/confirmation?code=${encodeURIComponent(json.profileCode)}`);
    } catch {
      show("Something went wrong. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const localizedTitles = [
    t("step1Title"),
    t("step2Title"),
    t("step3Title"),
    t("step4Title"),
    t("step5Title"),
    t("step6Title"),
    t("step7Title"),
    t("step8Title"),
  ];

  return (
    <div className="mx-auto max-w-2xl px-4 py-12 pb-28 sm:px-6 sm:pb-12" dir={locale === "ur" ? "rtl" : "ltr"}>
      {/* Honeypot — visually hidden, never seen by real users. A filled value
          server-side is treated as spam and silently rejected. */}
      <input
        type="text"
        name="hp_field"
        value={data.hp}
        onChange={(e) => setData((prev) => ({ ...prev, hp: e.target.value }))}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", top: "-9999px", width: 1, height: 1, opacity: 0 }}
      />

      <div className="mb-4 flex justify-end">
        <LocaleToggle />
      </div>

      {draftBanner && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium">{t("draftFoundTitle")}</p>
            <p className="text-xs text-muted">
              {t("draftFoundBody")} ({timeAgo(draftBanner.savedAt)})
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant="outline" onClick={discardDraft}>
              {t("startOver")}
            </Button>
            <Button size="sm" onClick={resumeDraft}>
              {t("resumeDraft")}
            </Button>
          </div>
        </div>
      )}

      <StepIndicator current={step} total={STEP_TITLES.length} titles={localizedTitles} />

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
          />
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface p-4 sm:static sm:z-auto sm:mt-8 sm:border-0 sm:bg-transparent sm:p-0">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <Button variant="outline" onClick={back} disabled={step === 0}>
            <ChevronLeft className="h-4 w-4" /> {t("back")}
          </Button>
          <Button variant="ghost" size="sm" onClick={saveDraftNow} className="hidden sm:inline-flex">
            <Save className="h-4 w-4" /> {t("saveDraft")}
          </Button>
          {step < STEP_TITLES.length - 1 ? (
            <Button onClick={next}>
              {t("next")} <ChevronRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />} {t("submit")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function RegistrationWizard() {
  return (
    <RegistrationLocaleProvider>
      <WizardBody />
    </RegistrationLocaleProvider>
  );
}
