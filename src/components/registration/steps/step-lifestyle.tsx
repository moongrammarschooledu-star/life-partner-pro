import { Field, Input, Checkbox, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";

export function StepLifestyle({
  data,
  onChange,
}: {
  data: WizardData["lifestyle"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["lifestyle"]>(field: K, value: WizardData["lifestyle"][K]) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">All fields in this section are optional.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Religious Preference" htmlFor="religion">
          <Input id="religion" value={data.religion} onChange={(e) => onChange("religion", e.target.value)} />
        </Field>
        <Field label="Sect / School of Thought" htmlFor="sect">
          <Input id="sect" value={data.sect} onChange={(e) => onChange("sect", e.target.value)} />
        </Field>
        <Field label="Religious Practice" htmlFor="religiousPractice">
          <Input id="religiousPractice" value={data.religiousPractice} onChange={(e) => onChange("religiousPractice", e.target.value)} placeholder="e.g. Practicing" />
        </Field>
        <Field label="Languages" htmlFor="languages">
          <Input id="languages" value={data.languages} onChange={(e) => onChange("languages", e.target.value)} placeholder="e.g. Urdu, English" />
        </Field>
      </div>
      <div className="flex gap-6">
        <Checkbox label="Smoking" checked={data.smoking} onChange={(e) => onChange("smoking", e.target.checked)} />
        <Checkbox label="Drinking" checked={data.drinking} onChange={(e) => onChange("drinking", e.target.checked)} />
      </div>
      <Field label="Other Lifestyle Preferences" htmlFor="otherPreferences">
        <Textarea id="otherPreferences" value={data.otherPreferences} onChange={(e) => onChange("otherPreferences", e.target.value)} />
      </Field>
    </div>
  );
}
