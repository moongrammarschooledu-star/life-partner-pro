"use client";

import { Field, Input, Checkbox, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";
import { useRegistrationLocale } from "@/components/registration/locale-context";

const LANGUAGE_OPTIONS = ["Urdu", "English", "Punjabi", "Arabic"];
const PERSONALITY_OPTIONS = ["Calm", "Friendly", "Responsible", "Family Oriented", "Ambitious", "Caring", "Social", "Reserved", "Practical"];

function MultiCheckboxGroup({
  options,
  value,
  onChange,
  allowCustom,
}: {
  options: string[];
  value: string; // comma-separated
  onChange: (v: string) => void;
  allowCustom?: boolean;
}) {
  const selected = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const custom = selected.filter((s) => !options.includes(s)).join(", ");

  function toggle(option: string) {
    const next = selected.includes(option) ? selected.filter((s) => s !== option) : [...selected, option];
    onChange(next.join(", "));
  }

  function setCustom(text: string) {
    const known = selected.filter((s) => options.includes(s));
    const customItems = text
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onChange([...known, ...customItems].join(", "));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((option) => (
          <Checkbox key={option} label={option} checked={selected.includes(option)} onChange={() => toggle(option)} />
        ))}
      </div>
      {allowCustom && (
        <Input placeholder="Other (comma-separated)" value={custom} onChange={(e) => setCustom(e.target.value)} />
      )}
    </div>
  );
}

export function StepLifestyle({
  data,
  onChange,
}: {
  data: WizardData["lifestyle"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["lifestyle"]>(field: K, value: WizardData["lifestyle"][K]) => void;
}) {
  const { t } = useRegistrationLocale();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">All fields in this section are optional.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("religion")} htmlFor="religion">
          <Input id="religion" value={data.religion} onChange={(e) => onChange("religion", e.target.value)} />
        </Field>
        <Field label={t("sect")} htmlFor="sect">
          <Input id="sect" value={data.sect} onChange={(e) => onChange("sect", e.target.value)} />
        </Field>
        <Field label={t("religiousPractice")} htmlFor="religiousPractice">
          <Input id="religiousPractice" value={data.religiousPractice} onChange={(e) => onChange("religiousPractice", e.target.value)} placeholder="e.g. Practicing" />
        </Field>
      </div>

      <Field label={t("languages")} htmlFor="languages">
        <MultiCheckboxGroup options={LANGUAGE_OPTIONS} value={data.languages} onChange={(v) => onChange("languages", v)} allowCustom />
      </Field>

      <div className="flex gap-6">
        <Field label={t("smoking")} htmlFor="smoking">
          <Checkbox label={t("yes")} checked={data.smoking} onChange={(e) => onChange("smoking", e.target.checked)} />
        </Field>
        <Field label={t("drinking")} htmlFor="drinking">
          <Checkbox label={t("yes")} checked={data.drinking} onChange={(e) => onChange("drinking", e.target.checked)} />
        </Field>
      </div>

      <Field label={t("hobbies")} htmlFor="hobbies">
        <Textarea
          id="hobbies"
          value={data.hobbies}
          onChange={(e) => onChange("hobbies", e.target.value)}
          placeholder="e.g. Reading, Travel, Cooking"
          rows={2}
        />
      </Field>

      <Field label={t("personality")} htmlFor="personality">
        <MultiCheckboxGroup options={PERSONALITY_OPTIONS} value={data.personality} onChange={(v) => onChange("personality", v)} allowCustom />
      </Field>

      <Field label={t("aboutMe")} htmlFor="aboutMe">
        <Textarea id="aboutMe" value={data.aboutMe} onChange={(e) => onChange("aboutMe", e.target.value)} placeholder={t("aboutMePlaceholder")} rows={4} />
      </Field>

      <Field label="Other Lifestyle Preferences" htmlFor="otherPreferences">
        <Textarea id="otherPreferences" value={data.otherPreferences} onChange={(e) => onChange("otherPreferences", e.target.value)} />
      </Field>
    </div>
  );
}
