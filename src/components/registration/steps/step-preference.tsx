import { Field, Input, Select, Checkbox, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";
import { useRegistrationLocale } from "@/components/registration/locale-context";

const LOCATION_SCOPES = ["Same Area", "Same City", "Same Region", "Anywhere in Country", "International", "Flexible"];

function PriorityField({
  value,
  onChange,
}: {
  value: "MUST_HAVE" | "PREFERRED" | "FLEXIBLE";
  onChange: (v: "MUST_HAVE" | "PREFERRED" | "FLEXIBLE") => void;
}) {
  const { t } = useRegistrationLocale();
  return (
    <Field label={t("priority")} htmlFor="priority">
      <Select value={value} onChange={(e) => onChange(e.target.value as "MUST_HAVE" | "PREFERRED" | "FLEXIBLE")}>
        <option value="MUST_HAVE">{t("mustHave")}</option>
        <option value="PREFERRED">{t("preferred")}</option>
        <option value="FLEXIBLE">{t("flexible")}</option>
      </Select>
    </Field>
  );
}

export function StepPreference({
  data,
  errors,
  onChange,
}: {
  data: WizardData["preference"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["preference"]>(field: K, value: WizardData["preference"][K]) => void;
}) {
  const { t } = useRegistrationLocale();
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-3">{t("agePreference")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("minAge")} htmlFor="minAge">
            <Input id="minAge" type="number" min={18} value={data.minAge} onChange={(e) => onChange("minAge", e.target.value)} />
          </Field>
          <Field label={t("maxAge")} htmlFor="maxAge">
            <Input id="maxAge" type="number" min={18} value={data.maxAge} onChange={(e) => onChange("maxAge", e.target.value)} />
          </Field>
          <PriorityField value={data.agePriority} onChange={(v) => onChange("agePriority", v)} />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">{t("locationPreference")}</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label={t("country")} htmlFor="preferredCountry">
            <Input id="preferredCountry" value={data.preferredCountry} onChange={(e) => onChange("preferredCountry", e.target.value)} />
          </Field>
          <Field label={t("city")} htmlFor="preferredCity">
            <Input id="preferredCity" value={data.preferredCity} onChange={(e) => onChange("preferredCity", e.target.value)} />
          </Field>
          <Field label={t("area")} htmlFor="preferredArea">
            <Input id="preferredArea" value={data.preferredArea} onChange={(e) => onChange("preferredArea", e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Field label={t("locationScope")} htmlFor="locationScope">
            <Select id="locationScope" value={data.locationScope} onChange={(e) => onChange("locationScope", e.target.value)}>
              <option value="">Select</option>
              {LOCATION_SCOPES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
          <PriorityField value={data.locationPriority} onChange={(v) => onChange("locationPriority", v)} />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">{t("educationPreference")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum Education" htmlFor="minEducation">
            <Input id="minEducation" value={data.minEducation} onChange={(e) => onChange("minEducation", e.target.value)} placeholder="e.g. Bachelors" />
          </Field>
          <Field label="Preferred Education" htmlFor="preferredEducation">
            <Input id="preferredEducation" value={data.preferredEducation} onChange={(e) => onChange("preferredEducation", e.target.value)} placeholder="e.g. Masters" />
          </Field>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">{t("professionPreference")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("professionPreference")} htmlFor="professionPreference">
            <Select id="professionPreference" value={data.professionPreference} onChange={(e) => onChange("professionPreference", e.target.value)}>
              <option value="ANY">Any Profession</option>
              <option value="Government">Government</option>
              <option value="Private">Private</option>
              <option value="Business">Business</option>
              <option value="Doctor">Doctor</option>
              <option value="Engineer">Engineer</option>
              <option value="Teacher">Teacher</option>
              <option value="IT">IT / Software</option>
              <option value="Finance">Finance</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Legal">Legal</option>
              <option value="Freelancer">Freelancer</option>
              <option value="Other">Other</option>
            </Select>
          </Field>
          <PriorityField value={data.professionPriority} onChange={(v) => onChange("professionPriority", v)} />
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">🔒 {t("incomePreference")} — {t("adminOnlyIncome")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("minIncome")} htmlFor="minIncome">
            <Input id="minIncome" type="number" min={0} value={data.minIncome} onChange={(e) => onChange("minIncome", e.target.value)} disabled={data.incomeFlexible} />
          </Field>
          <Field label={t("maxIncome")} htmlFor="maxIncome">
            <Input id="maxIncome" type="number" min={0} value={data.maxIncome} onChange={(e) => onChange("maxIncome", e.target.value)} disabled={data.incomeFlexible} />
          </Field>
        </div>
        <div className="mt-2">
          <Checkbox label={t("incomeFlexible")} checked={data.incomeFlexible} onChange={(e) => onChange("incomeFlexible", e.target.checked)} />
        </div>
      </div>

      <Field label={t("maritalStatusPreference")} htmlFor="maritalStatusPreference">
        <Select id="maritalStatusPreference" value={data.maritalStatusPreference} onChange={(e) => onChange("maritalStatusPreference", e.target.value)}>
          <option value="ANY">Any</option>
          <option value="NEVER_MARRIED">Never Married</option>
          <option value="DIVORCED">Divorced</option>
          <option value="WIDOWED">Widowed</option>
          <option value="SEPARATED">Separated</option>
        </Select>
      </Field>

      <div>
        <p className="text-sm font-medium mb-3">{t("heightPreference")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("minHeight")} htmlFor="minHeightCm">
            <Input id="minHeightCm" type="number" min={100} max={230} value={data.minHeightCm} onChange={(e) => onChange("minHeightCm", e.target.value)} />
          </Field>
          <Field label={t("maxHeight")} htmlFor="maxHeightCm">
            <Input id="maxHeightCm" type="number" min={100} max={230} value={data.maxHeightCm} onChange={(e) => onChange("maxHeightCm", e.target.value)} />
          </Field>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">{t("familyPreference")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Family Type" htmlFor="familyTypePreference">
            <Select id="familyTypePreference" value={data.familyTypePreference} onChange={(e) => onChange("familyTypePreference", e.target.value)}>
              <option value="ANY">Flexible</option>
              <option value="NUCLEAR">Nuclear</option>
              <option value="JOINT">Joint</option>
              <option value="EXTENDED">Either</option>
            </Select>
          </Field>
          <Field label="Family Status" htmlFor="familyBackgroundPreference">
            <Select id="familyBackgroundPreference" value={data.familyBackgroundPreference} onChange={(e) => onChange("familyBackgroundPreference", e.target.value)}>
              <option value="ANY">Flexible</option>
              <option value="MIDDLE_CLASS">Middle</option>
              <option value="UPPER_MIDDLE_CLASS">Upper Middle</option>
              <option value="WELL_SETTLED">Affluent</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Other Requirements" htmlFor="otherFamilyRequirements">
            <Textarea id="otherFamilyRequirements" value={data.otherFamilyRequirements} onChange={(e) => onChange("otherFamilyRequirements", e.target.value)} />
          </Field>
        </div>
      </div>

      <Field label={t("additionalExpectations")} error={errors.additionalExpectations} htmlFor="additionalExpectations" hint={`🔒 ${t("privateNotice")}`}>
        <Textarea
          id="additionalExpectations"
          rows={5}
          value={data.additionalExpectations}
          onChange={(e) => onChange("additionalExpectations", e.target.value)}
          placeholder={t("additionalExpectationsPlaceholder")}
        />
      </Field>
    </div>
  );
}
