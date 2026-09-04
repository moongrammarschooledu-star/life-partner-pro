import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";
import { useRegistrationLocale } from "@/components/registration/locale-context";

const JOB_TYPES = new Set(["GOVERNMENT", "PRIVATE"]);
const BUSINESS_TYPES = new Set(["BUSINESS_OWNER", "SELF_EMPLOYED", "FREELANCE"]);

export function StepEducationProfession({
  data,
  errors,
  onChange,
}: {
  data: WizardData["educationProfession"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["educationProfession"]>(field: K, value: WizardData["educationProfession"][K]) => void;
}) {
  const { t } = useRegistrationLocale();
  const isJob = JOB_TYPES.has(data.employmentType);
  const isBusiness = BUSINESS_TYPES.has(data.employmentType);
  const isStudent = data.employmentType === "STUDENT";
  const isNotWorking = data.employmentType === "NOT_WORKING";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("educationLevel")} error={errors.educationLevel} htmlFor="educationLevel">
        <Select id="educationLevel" value={data.educationLevel} onChange={(e) => onChange("educationLevel", e.target.value)}>
          <option value="">Select</option>
          <option value="Primary">Primary</option>
          <option value="Middle">Middle</option>
          <option value="Matric">Matric / O-Level</option>
          <option value="Intermediate">Intermediate / A-Level</option>
          <option value="Diploma">Diploma</option>
          <option value="Bachelors">Bachelor&apos;s</option>
          <option value="Masters">Master&apos;s</option>
          <option value="MPhil">MPhil</option>
          <option value="PhD">PhD</option>
          <option value="Other">Other</option>
        </Select>
      </Field>
      <Field label={t("degree")} htmlFor="degree">
        <Input id="degree" value={data.degree} onChange={(e) => onChange("degree", e.target.value)} placeholder="e.g. MBA" />
      </Field>
      <Field label={t("institution")} htmlFor="institution">
        <Input id="institution" value={data.institution} onChange={(e) => onChange("institution", e.target.value)} />
      </Field>
      <Field label={t("profession")} error={errors.profession} htmlFor="profession">
        <Input id="profession" value={data.profession} onChange={(e) => onChange("profession", e.target.value)} placeholder="e.g. Software Engineer" />
      </Field>
      <Field label={t("employmentType")} htmlFor="employmentType">
        <Select
          id="employmentType"
          value={data.employmentType}
          onChange={(e) => onChange("employmentType", e.target.value as WizardData["educationProfession"]["employmentType"])}
        >
          <option value="GOVERNMENT">Government Job</option>
          <option value="PRIVATE">Private Job</option>
          <option value="SELF_EMPLOYED">Self Employed</option>
          <option value="BUSINESS_OWNER">Business</option>
          <option value="FREELANCE">Freelancer</option>
          <option value="STUDENT">Student</option>
          <option value="NOT_WORKING">Not Working</option>
        </Select>
      </Field>

      {isJob && (
        <>
          <Field label={t("jobTitle")} htmlFor="jobTitle">
            <Input id="jobTitle" value={data.jobTitle} onChange={(e) => onChange("jobTitle", e.target.value)} />
          </Field>
          <Field label={t("companyName")} htmlFor="companyName">
            <Input id="companyName" value={data.companyName} onChange={(e) => onChange("companyName", e.target.value)} />
          </Field>
          <Field label={t("workLocation")} htmlFor="workLocation">
            <Input id="workLocation" value={data.workLocation} onChange={(e) => onChange("workLocation", e.target.value)} />
          </Field>
          <Field label={`🔒 ${t("monthlyIncome")}`} hint={t("adminOnlyIncome")} htmlFor="monthlyIncome">
            <Input id="monthlyIncome" type="number" min={0} value={data.monthlyIncome} onChange={(e) => onChange("monthlyIncome", e.target.value)} />
          </Field>
        </>
      )}

      {isBusiness && (
        <>
          <Field label={t("companyName")} htmlFor="companyNameBiz">
            <Input id="companyNameBiz" value={data.companyName} onChange={(e) => onChange("companyName", e.target.value)} placeholder="Business Name" />
          </Field>
          <Field label={t("workLocation")} htmlFor="workLocationBiz">
            <Input id="workLocationBiz" value={data.workLocation} onChange={(e) => onChange("workLocation", e.target.value)} placeholder="Business Location" />
          </Field>
          <Field label={`🔒 ${t("monthlyIncome")}`} hint={t("adminOnlyIncome")} htmlFor="monthlyIncomeBiz">
            <Input id="monthlyIncomeBiz" type="number" min={0} value={data.monthlyIncome} onChange={(e) => onChange("monthlyIncome", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label={t("businessDetails")} htmlFor="businessDetails">
              <Textarea id="businessDetails" value={data.businessDetails} onChange={(e) => onChange("businessDetails", e.target.value)} placeholder="Business Type" />
            </Field>
          </div>
        </>
      )}

      {isStudent && (
        <>
          <Field label={t("program")} htmlFor="program">
            <Input id="program" value={data.program} onChange={(e) => onChange("program", e.target.value)} />
          </Field>
          <Field label={t("expectedGraduation")} htmlFor="expectedGraduation">
            <Input id="expectedGraduation" value={data.expectedGraduation} onChange={(e) => onChange("expectedGraduation", e.target.value)} placeholder="e.g. 2027" />
          </Field>
        </>
      )}

      {isNotWorking && <p className="sm:col-span-2 text-sm text-muted">No additional details needed for this employment type.</p>}

      <Field label={t("annualIncome")} hint={t("adminOnlyIncome")} htmlFor="annualIncome">
        <Input id="annualIncome" type="number" min={0} value={data.annualIncome} onChange={(e) => onChange("annualIncome", e.target.value)} />
      </Field>
    </div>
  );
}
