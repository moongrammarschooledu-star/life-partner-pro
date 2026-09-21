"use client";

import { Field, Input, Select, Checkbox } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";
import { useRegistrationLocale } from "@/components/registration/locale-context";
import { calculateAge } from "@/lib/utils";
import { COUNTRIES, citiesFor } from "@/lib/geo-data";
import { HeightSelect } from "@/components/registration/steps/height-select";
import { OptionalSection } from "@/components/registration/steps/optional-section";

const CHILDREN_STATUSES = new Set(["DIVORCED", "WIDOWED", "SEPARATED"]);

export function StepBasic({
  data,
  errors,
  onChange,
}: {
  data: WizardData["basic"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["basic"]>(field: K, value: WizardData["basic"][K]) => void;
}) {
  const { t } = useRegistrationLocale();
  const age = data.dateOfBirth ? calculateAge(data.dateOfBirth) : null;
  const showChildrenFields = CHILDREN_STATUSES.has(data.maritalStatus);
  const cityOptions = citiesFor(data.country);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("fullName")} error={errors.fullName} htmlFor="fullName">
        <Input
          id="fullName"
          value={data.fullName}
          onChange={(e) => onChange("fullName", e.target.value)}
          placeholder="e.g. Ayesha Siddiqui"
          aria-invalid={!!errors.fullName}
        />
      </Field>
      <Field label={t("gender")} error={errors.gender} htmlFor="gender">
        <Select id="gender" value={data.gender} onChange={(e) => onChange("gender", e.target.value as WizardData["basic"]["gender"])}>
          <option value="">{t("selectGender")}</option>
          <option value="MALE">{t("male")}</option>
          <option value="FEMALE">{t("female")}</option>
        </Select>
      </Field>
      <Field label={t("dateOfBirth")} error={errors.dateOfBirth} htmlFor="dob">
        <Input id="dob" type="date" max={new Date().toISOString().slice(0, 10)} value={data.dateOfBirth} onChange={(e) => onChange("dateOfBirth", e.target.value)} />
      </Field>
      <Field label={t("age")} htmlFor="age" hint={t("ageAuto")}>
        <Input id="age" value={age ?? ""} readOnly disabled className="bg-surface-muted" />
      </Field>
      <Field label={t("maritalStatus")} error={errors.maritalStatus} htmlFor="maritalStatus">
        <Select
          id="maritalStatus"
          value={data.maritalStatus}
          onChange={(e) => onChange("maritalStatus", e.target.value as WizardData["basic"]["maritalStatus"])}
        >
          <option value="">{t("selectStatus")}</option>
          <option value="NEVER_MARRIED">Never Married</option>
          <option value="DIVORCED">Divorced</option>
          <option value="WIDOWED">Widowed</option>
          <option value="SEPARATED">Separated</option>
          <option value="OTHER">Other</option>
        </Select>
      </Field>
      {showChildrenFields && (
        <>
          <Field label={t("hasChildren")} htmlFor="hasChildren">
            <Checkbox
              id="hasChildren"
              label={t("yes")}
              checked={!!data.hasChildren}
              onChange={(e) => onChange("hasChildren", e.target.checked)}
            />
          </Field>
          {data.hasChildren && (
            <Field label={t("numberOfChildren")} htmlFor="numberOfChildren">
              <Input
                id="numberOfChildren"
                type="number"
                min={0}
                max={20}
                value={data.numberOfChildren}
                onChange={(e) => onChange("numberOfChildren", e.target.value)}
              />
            </Field>
          )}
        </>
      )}
      <Field label={t("height")} error={errors.heightCm} htmlFor="heightCm">
        <HeightSelect id="heightCm" value={data.heightCm} onChange={(v) => onChange("heightCm", v)} />
      </Field>
      <Field label={t("country")} error={errors.country} htmlFor="country">
        <Select id="country" value={data.country} onChange={(e) => onChange("country", e.target.value)}>
          <option value="">{t("selectCountry")}</option>
          {COUNTRIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("city")} error={errors.city} htmlFor="city">
        <Input
          id="city"
          list="city-options"
          value={data.city}
          onChange={(e) => onChange("city", e.target.value)}
          placeholder="e.g. Lahore"
          aria-invalid={!!errors.city}
        />
        <datalist id="city-options">
          {cityOptions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <div className="sm:col-span-2">
        <OptionalSection>
          <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("area")} htmlFor="area">
            <Input id="area" value={data.area} onChange={(e) => onChange("area", e.target.value)} placeholder="e.g. Model Town" />
          </Field>
          <Field label={t("nationality")} htmlFor="nationality">
            <Input id="nationality" value={data.nationality} onChange={(e) => onChange("nationality", e.target.value)} placeholder="e.g. Pakistani" />
          </Field>
          </div>
        </OptionalSection>
      </div>
    </div>
  );
}
