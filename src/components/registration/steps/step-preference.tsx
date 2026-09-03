import { Field, Input, Select, Checkbox, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";

export function StepPreference({
  data,
  errors,
  onChange,
}: {
  data: WizardData["preference"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["preference"]>(field: K, value: WizardData["preference"][K]) => void;
}) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium mb-3">Preferred Age</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum Age" htmlFor="minAge">
            <Input id="minAge" type="number" min={18} value={data.minAge} onChange={(e) => onChange("minAge", e.target.value)} />
          </Field>
          <Field label="Maximum Age" htmlFor="maxAge">
            <Input id="maxAge" type="number" min={18} value={data.maxAge} onChange={(e) => onChange("maxAge", e.target.value)} />
          </Field>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">Preferred Location</p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Country" htmlFor="preferredCountry">
            <Input id="preferredCountry" value={data.preferredCountry} onChange={(e) => onChange("preferredCountry", e.target.value)} />
          </Field>
          <Field label="City" htmlFor="preferredCity">
            <Input id="preferredCity" value={data.preferredCity} onChange={(e) => onChange("preferredCity", e.target.value)} />
          </Field>
          <Field label="Area" htmlFor="preferredArea">
            <Input id="preferredArea" value={data.preferredArea} onChange={(e) => onChange("preferredArea", e.target.value)} />
          </Field>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">Education Requirement</p>
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
        <p className="text-sm font-medium mb-3">Profession</p>
        <Field label="Profession Preference" htmlFor="professionPreference">
          <Select id="professionPreference" value={data.professionPreference} onChange={(e) => onChange("professionPreference", e.target.value)}>
            <option value="ANY">Any Profession</option>
            <option value="Job">Job</option>
            <option value="Business">Business</option>
          </Select>
        </Field>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">Income Preference</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum Income (USD)" htmlFor="minIncome">
            <Input id="minIncome" type="number" min={0} value={data.minIncome} onChange={(e) => onChange("minIncome", e.target.value)} disabled={data.incomeFlexible} />
          </Field>
          <Field label="Maximum Income (USD)" htmlFor="maxIncome">
            <Input id="maxIncome" type="number" min={0} value={data.maxIncome} onChange={(e) => onChange("maxIncome", e.target.value)} disabled={data.incomeFlexible} />
          </Field>
        </div>
        <div className="mt-2">
          <Checkbox label="Flexible on income" checked={data.incomeFlexible} onChange={(e) => onChange("incomeFlexible", e.target.checked)} />
        </div>
      </div>

      <Field label="Marital Status Preference" htmlFor="maritalStatusPreference">
        <Select id="maritalStatusPreference" value={data.maritalStatusPreference} onChange={(e) => onChange("maritalStatusPreference", e.target.value)}>
          <option value="ANY">Any</option>
          <option value="NEVER_MARRIED">Never Married</option>
          <option value="DIVORCED">Divorced</option>
          <option value="WIDOWED">Widowed</option>
        </Select>
      </Field>

      <div>
        <p className="text-sm font-medium mb-3">Height Preference</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum Height (cm)" htmlFor="minHeightCm">
            <Input id="minHeightCm" type="number" min={100} max={230} value={data.minHeightCm} onChange={(e) => onChange("minHeightCm", e.target.value)} />
          </Field>
          <Field label="Maximum Height (cm)" htmlFor="maxHeightCm">
            <Input id="maxHeightCm" type="number" min={100} max={230} value={data.maxHeightCm} onChange={(e) => onChange("maxHeightCm", e.target.value)} />
          </Field>
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-3">Family Preference</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Family Type" htmlFor="familyTypePreference">
            <Select id="familyTypePreference" value={data.familyTypePreference} onChange={(e) => onChange("familyTypePreference", e.target.value)}>
              <option value="ANY">Any</option>
              <option value="NUCLEAR">Nuclear</option>
              <option value="JOINT">Joint</option>
              <option value="EXTENDED">Extended</option>
            </Select>
          </Field>
          <Field label="Family Background" htmlFor="familyBackgroundPreference">
            <Select id="familyBackgroundPreference" value={data.familyBackgroundPreference} onChange={(e) => onChange("familyBackgroundPreference", e.target.value)}>
              <option value="ANY">Any</option>
              <option value="MIDDLE_CLASS">Middle Class</option>
              <option value="UPPER_MIDDLE_CLASS">Upper Middle Class</option>
              <option value="WELL_SETTLED">Well Settled</option>
            </Select>
          </Field>
        </div>
        <div className="mt-4">
          <Field label="Other Requirements" htmlFor="otherFamilyRequirements">
            <Textarea id="otherFamilyRequirements" value={data.otherFamilyRequirements} onChange={(e) => onChange("otherFamilyRequirements", e.target.value)} />
          </Field>
        </div>
      </div>

      <Field label="Describe your preferred life partner and any important requirements" error={errors.additionalExpectations} htmlFor="additionalExpectations">
        <Textarea
          id="additionalExpectations"
          rows={5}
          value={data.additionalExpectations}
          onChange={(e) => onChange("additionalExpectations", e.target.value)}
        />
      </Field>
    </div>
  );
}
