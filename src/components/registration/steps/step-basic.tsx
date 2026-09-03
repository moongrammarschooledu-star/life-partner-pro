import { Field, Input, Select } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";

export function StepBasic({
  data,
  errors,
  onChange,
}: {
  data: WizardData["basic"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["basic"]>(field: K, value: WizardData["basic"][K]) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Full Name" error={errors.fullName} htmlFor="fullName">
        <Input id="fullName" value={data.fullName} onChange={(e) => onChange("fullName", e.target.value)} placeholder="e.g. Ayesha Siddiqui" />
      </Field>
      <Field label="Gender" error={errors.gender} htmlFor="gender">
        <Select id="gender" value={data.gender} onChange={(e) => onChange("gender", e.target.value as WizardData["basic"]["gender"])}>
          <option value="">Select gender</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
        </Select>
      </Field>
      <Field label="Date of Birth" error={errors.dateOfBirth} htmlFor="dob">
        <Input id="dob" type="date" value={data.dateOfBirth} onChange={(e) => onChange("dateOfBirth", e.target.value)} />
      </Field>
      <Field label="Marital Status" error={errors.maritalStatus} htmlFor="maritalStatus">
        <Select
          id="maritalStatus"
          value={data.maritalStatus}
          onChange={(e) => onChange("maritalStatus", e.target.value as WizardData["basic"]["maritalStatus"])}
        >
          <option value="">Select status</option>
          <option value="NEVER_MARRIED">Never Married</option>
          <option value="DIVORCED">Divorced</option>
          <option value="WIDOWED">Widowed</option>
          <option value="ANNULLED">Annulled</option>
        </Select>
      </Field>
      <Field label="Height (cm)" error={errors.heightCm} htmlFor="heightCm">
        <Input id="heightCm" type="number" min={100} max={230} value={data.heightCm} onChange={(e) => onChange("heightCm", e.target.value)} />
      </Field>
      <Field label="City" error={errors.city} htmlFor="city">
        <Input id="city" value={data.city} onChange={(e) => onChange("city", e.target.value)} placeholder="e.g. Lahore" />
      </Field>
      <Field label="Area" htmlFor="area">
        <Input id="area" value={data.area} onChange={(e) => onChange("area", e.target.value)} placeholder="e.g. Model Town" />
      </Field>
      <Field label="Country" error={errors.country} htmlFor="country">
        <Input id="country" value={data.country} onChange={(e) => onChange("country", e.target.value)} placeholder="e.g. Pakistan" />
      </Field>
      <Field label="Nationality" htmlFor="nationality">
        <Input id="nationality" value={data.nationality} onChange={(e) => onChange("nationality", e.target.value)} placeholder="e.g. Pakistani" />
      </Field>
    </div>
  );
}
