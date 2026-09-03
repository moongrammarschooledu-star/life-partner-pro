import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";

export function StepEducationProfession({
  data,
  errors,
  onChange,
}: {
  data: WizardData["educationProfession"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["educationProfession"]>(field: K, value: WizardData["educationProfession"][K]) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Education Level" error={errors.educationLevel} htmlFor="educationLevel">
        <Input id="educationLevel" value={data.educationLevel} onChange={(e) => onChange("educationLevel", e.target.value)} placeholder="e.g. Masters" />
      </Field>
      <Field label="Degree" htmlFor="degree">
        <Input id="degree" value={data.degree} onChange={(e) => onChange("degree", e.target.value)} placeholder="e.g. MBA" />
      </Field>
      <Field label="Institution" htmlFor="institution">
        <Input id="institution" value={data.institution} onChange={(e) => onChange("institution", e.target.value)} />
      </Field>
      <Field label="Profession" error={errors.profession} htmlFor="profession">
        <Input id="profession" value={data.profession} onChange={(e) => onChange("profession", e.target.value)} placeholder="e.g. Software Engineer" />
      </Field>
      <Field label="Job Title" htmlFor="jobTitle">
        <Input id="jobTitle" value={data.jobTitle} onChange={(e) => onChange("jobTitle", e.target.value)} />
      </Field>
      <Field label="Company / Business Name" htmlFor="companyName">
        <Input id="companyName" value={data.companyName} onChange={(e) => onChange("companyName", e.target.value)} />
      </Field>
      <Field label="Employment Type" htmlFor="employmentType">
        <Select
          id="employmentType"
          value={data.employmentType}
          onChange={(e) => onChange("employmentType", e.target.value as WizardData["educationProfession"]["employmentType"])}
        >
          <option value="GOVERNMENT">Government</option>
          <option value="PRIVATE">Private</option>
          <option value="BUSINESS_OWNER">Business Owner</option>
          <option value="SELF_EMPLOYED">Self Employed</option>
          <option value="FREELANCE">Freelance</option>
          <option value="NOT_WORKING">Not Working</option>
          <option value="STUDENT">Student</option>
        </Select>
      </Field>
      <Field label="Work Location" htmlFor="workLocation">
        <Input id="workLocation" value={data.workLocation} onChange={(e) => onChange("workLocation", e.target.value)} />
      </Field>
      <Field label="Monthly Income (USD)" hint="Kept private — only visible to admins" htmlFor="monthlyIncome">
        <Input id="monthlyIncome" type="number" min={0} value={data.monthlyIncome} onChange={(e) => onChange("monthlyIncome", e.target.value)} />
      </Field>
      <Field label="Annual Income (USD)" htmlFor="annualIncome">
        <Input id="annualIncome" type="number" min={0} value={data.annualIncome} onChange={(e) => onChange("annualIncome", e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Business Details (if applicable)" htmlFor="businessDetails">
          <Textarea id="businessDetails" value={data.businessDetails} onChange={(e) => onChange("businessDetails", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
