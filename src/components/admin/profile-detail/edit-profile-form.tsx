"use client";

import { useState } from "react";
import { Loader2, Save, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { RegistrationLocaleProvider } from "@/components/registration/locale-context";
import { StepBasic } from "@/components/registration/steps/step-basic";
import { StepEducationProfession } from "@/components/registration/steps/step-education-profession";
import { StepFamily } from "@/components/registration/steps/step-family";
import { StepLifestyle } from "@/components/registration/steps/step-lifestyle";
import { StepPreference } from "@/components/registration/steps/step-preference";
import type { WizardData } from "@/components/registration/wizard-types";
import {
  basicInfoSchema,
  educationProfessionSchema,
  familyInfoSchema,
  partnerPreferenceSchema,
} from "@/lib/validation/registration";
import type { ProfileDetailDto } from "@/lib/serializers";
import type { ZodError } from "zod";

type EditableSections = Pick<WizardData, "basic" | "educationProfession" | "family" | "lifestyle" | "preference">;

function toDateInput(value: string | Date): string {
  return String(value).slice(0, 10);
}
function numOrEmpty(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function toEditableSections(profile: ProfileDetailDto): EditableSections {
  return {
    basic: {
      fullName: profile.fullName,
      gender: profile.gender as WizardData["basic"]["gender"],
      dateOfBirth: toDateInput(profile.dateOfBirth),
      maritalStatus: profile.maritalStatus as WizardData["basic"]["maritalStatus"],
      hasChildren: profile.hasChildren,
      numberOfChildren: numOrEmpty(profile.numberOfChildren),
      heightCm: numOrEmpty(profile.heightCm),
      city: profile.city,
      area: profile.area ?? "",
      country: profile.country,
      nationality: profile.nationality ?? "",
    },
    educationProfession: {
      educationLevel: profile.education?.level ?? "",
      degree: profile.education?.degree ?? "",
      institution: profile.education?.institution ?? "",
      profession: profile.profession?.profession ?? "",
      jobTitle: profile.profession?.jobTitle ?? "",
      companyName: profile.profession?.companyName ?? "",
      employmentType: (profile.profession?.employmentType as WizardData["educationProfession"]["employmentType"]) ?? "PRIVATE",
      monthlyIncome: numOrEmpty(profile.profession?.monthlyIncome),
      annualIncome: numOrEmpty(profile.profession?.annualIncome),
      workLocation: profile.profession?.workLocation ?? "",
      businessDetails: profile.profession?.businessDetails ?? "",
      program: profile.profession?.program ?? "",
      expectedGraduation: profile.profession?.expectedGraduation ?? "",
    },
    family: {
      fatherOccupation: profile.family?.fatherOccupation ?? "",
      motherOccupation: profile.family?.motherOccupation ?? "",
      numberOfBrothers: numOrEmpty(profile.family?.numberOfBrothers) || "0",
      numberOfSisters: numOrEmpty(profile.family?.numberOfSisters) || "0",
      familyType: (profile.family?.familyType as WizardData["family"]["familyType"]) ?? "NUCLEAR",
      familyStatus: (profile.family?.familyStatus as WizardData["family"]["familyStatus"]) ?? "MIDDLE_CLASS",
      familyLocation: profile.family?.familyLocation ?? "",
      familyBackground: profile.family?.familyBackground ?? "",
      additionalInfo: profile.family?.additionalInfo ?? "",
    },
    lifestyle: {
      religion: profile.lifestyle?.religion ?? "",
      sect: profile.lifestyle?.sect ?? "",
      religiousPractice: profile.lifestyle?.religiousPractice ?? "",
      languages: profile.lifestyle?.languages ?? "",
      smoking: profile.lifestyle?.smoking ?? false,
      drinking: profile.lifestyle?.drinking ?? false,
      hobbies: profile.lifestyle?.hobbies ?? "",
      personality: profile.lifestyle?.personality ?? "",
      aboutMe: profile.lifestyle?.aboutMe ?? "",
      otherPreferences: profile.lifestyle?.otherPreferences ?? "",
    },
    preference: {
      minAge: numOrEmpty(profile.preference?.minAge),
      maxAge: numOrEmpty(profile.preference?.maxAge),
      agePriority: (profile.preference?.agePriority as WizardData["preference"]["agePriority"]) ?? "PREFERRED",
      preferredCountry: profile.preference?.preferredCountry ?? "",
      preferredCity: profile.preference?.preferredCity ?? "",
      preferredArea: profile.preference?.preferredArea ?? "",
      locationScope: profile.preference?.locationScope ?? "",
      locationPriority: (profile.preference?.locationPriority as WizardData["preference"]["locationPriority"]) ?? "PREFERRED",
      minEducation: profile.preference?.minEducation ?? "",
      preferredEducation: profile.preference?.preferredEducation ?? "",
      professionPreference: profile.preference?.professionPreference ?? "",
      professionPriority: (profile.preference?.professionPriority as WizardData["preference"]["professionPriority"]) ?? "PREFERRED",
      minIncome: numOrEmpty(profile.preference?.minIncome),
      maxIncome: numOrEmpty(profile.preference?.maxIncome),
      incomeFlexible: profile.preference?.incomeFlexible ?? true,
      maritalStatusPreference: profile.preference?.maritalStatusPreference ?? "",
      minHeightCm: numOrEmpty(profile.preference?.minHeightCm),
      maxHeightCm: numOrEmpty(profile.preference?.maxHeightCm),
      familyTypePreference: profile.preference?.familyTypePreference ?? "",
      familyBackgroundPreference: profile.preference?.familyBackgroundPreference ?? "",
      otherFamilyRequirements: profile.preference?.otherFamilyRequirements ?? "",
      additionalExpectations: profile.preference?.additionalExpectations ?? "",
    },
  };
}

function zodErrorsToMap(error: ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of error.issues) map[String(issue.path[0])] = issue.message;
  return map;
}

// Every section here maps 1:1 onto the same StepXxx components and section
// schemas the public registration wizard uses (see
// components/registration/registration-wizard.tsx) — same fields, same
// validation. What's different for an existing profile: contact info, photo
// and consent are deliberately NOT editable here (contact stays behind
// STEP 13/17's dedicated reveal/share pipeline; consent is a point-in-time
// record, not something to retroactively edit), and family/income fields
// are hidden outright — not shown blank — for an admin who lacks
// sensitive:family:view / sensitive:income:view, per
// profile.permissionFlags (see serializers.ts). Submits everything in one
// PATCH to /api/admin/profiles/[id], which applies the same hidden-field
// protection server-side regardless of what this form sends.
export function EditProfileForm({ profile, onSaved, onCancel }: { profile: ProfileDetailDto; onSaved: () => void; onCancel: () => void }) {
  const { show } = useToast();
  const [data, setData] = useState<EditableSections>(() => toEditableSections(profile));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const canViewFamily = profile.permissionFlags.canViewFamily;
  const canViewIncome = profile.permissionFlags.canViewIncome;

  function updateSection<S extends keyof EditableSections>(section: S, field: keyof EditableSections[S], value: unknown) {
    setData((prev) => ({ ...prev, [section]: { ...prev[section], [field]: value } }));
  }

  function validate(): boolean {
    const allErrors: Record<string, string> = {};
    const basicResult = basicInfoSchema.safeParse(data.basic);
    if (!basicResult.success) Object.assign(allErrors, zodErrorsToMap(basicResult.error));
    const eduResult = educationProfessionSchema.safeParse(data.educationProfession);
    if (!eduResult.success) Object.assign(allErrors, zodErrorsToMap(eduResult.error));
    if (canViewFamily) {
      const familyResult = familyInfoSchema.safeParse(data.family);
      if (!familyResult.success) Object.assign(allErrors, zodErrorsToMap(familyResult.error));
    }
    const prefResult = partnerPreferenceSchema.safeParse(data.preference);
    if (!prefResult.success) Object.assign(allErrors, zodErrorsToMap(prefResult.error));
    setErrors(allErrors);
    return Object.keys(allErrors).length === 0;
  }

  async function save() {
    if (!validate()) {
      show("Please check the highlighted fields.", "error");
      return;
    }
    setSaving(true);
    try {
      const educationProfession: Record<string, unknown> = { ...data.educationProfession };
      if (!canViewIncome) {
        delete educationProfession.monthlyIncome;
        delete educationProfession.annualIncome;
      }

      const lifestyle: Record<string, unknown> = { ...data.lifestyle };
      if (!canViewFamily) {
        delete lifestyle.religion;
        delete lifestyle.sect;
        delete lifestyle.religiousPractice;
      }

      const body: Record<string, unknown> = {
        basic: data.basic,
        educationProfession,
        lifestyle,
        preference: data.preference,
      };
      if (canViewFamily) body.family = data.family;

      const res = await fetch(`/api/admin/profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not save changes.", "error");
        return;
      }
      show("Profile updated", "success");
      onSaved();
    } catch {
      show("Something went wrong. Please try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <RegistrationLocaleProvider>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Basic Information</CardTitle>
          </CardHeader>
          <CardContent>
            <StepBasic data={data.basic} errors={errors} onChange={(f, v) => updateSection("basic", f, v)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Education & Profession</CardTitle>
          </CardHeader>
          <CardContent>
            <StepEducationProfession
              data={data.educationProfession}
              errors={errors}
              onChange={(f, v) => updateSection("educationProfession", f, v)}
              hideIncome={!canViewIncome}
            />
            {!canViewIncome && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <Lock className="h-3 w-3" /> Income is hidden — you don&apos;t have permission to view or edit it.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Family Information</CardTitle>
          </CardHeader>
          <CardContent>
            {canViewFamily ? (
              <StepFamily data={data.family} onChange={(f, v) => updateSection("family", f, v)} />
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted">
                <Lock className="h-3.5 w-3.5" /> Hidden — you don&apos;t have permission to view or edit family details.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Lifestyle</CardTitle>
          </CardHeader>
          <CardContent>
            <StepLifestyle data={data.lifestyle} errors={errors} onChange={(f, v) => updateSection("lifestyle", f, v)} hideReligious={!canViewFamily} />
            {!canViewFamily && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
                <Lock className="h-3 w-3" /> Religion, sect and religious practice are hidden — you don&apos;t have permission to view or edit them.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Partner Requirements</CardTitle>
          </CardHeader>
          <CardContent>
            <StepPreference data={data.preference} errors={errors} onChange={(f, v) => updateSection("preference", f, v)} />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 pb-4">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
          </Button>
        </div>
      </div>
    </RegistrationLocaleProvider>
  );
}
