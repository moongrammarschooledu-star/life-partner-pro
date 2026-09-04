import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";
import { useRegistrationLocale } from "@/components/registration/locale-context";

export function StepFamily({
  data,
  onChange,
}: {
  data: WizardData["family"];
  onChange: <K extends keyof WizardData["family"]>(field: K, value: WizardData["family"][K]) => void;
}) {
  const { t } = useRegistrationLocale();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t("fatherOccupation")} htmlFor="fatherOccupation">
        <Input id="fatherOccupation" value={data.fatherOccupation} onChange={(e) => onChange("fatherOccupation", e.target.value)} />
      </Field>
      <Field label={t("motherOccupation")} htmlFor="motherOccupation">
        <Input id="motherOccupation" value={data.motherOccupation} onChange={(e) => onChange("motherOccupation", e.target.value)} />
      </Field>
      <Field label={t("numberOfBrothers")} htmlFor="numberOfBrothers">
        <Input id="numberOfBrothers" type="number" min={0} value={data.numberOfBrothers} onChange={(e) => onChange("numberOfBrothers", e.target.value)} />
      </Field>
      <Field label={t("numberOfSisters")} htmlFor="numberOfSisters">
        <Input id="numberOfSisters" type="number" min={0} value={data.numberOfSisters} onChange={(e) => onChange("numberOfSisters", e.target.value)} />
      </Field>
      <Field label={t("familyType")} htmlFor="familyType">
        <Select id="familyType" value={data.familyType} onChange={(e) => onChange("familyType", e.target.value as WizardData["family"]["familyType"])}>
          <option value="NUCLEAR">Nuclear</option>
          <option value="JOINT">Joint</option>
          <option value="EXTENDED">Extended</option>
        </Select>
      </Field>
      <Field label={t("familyStatus")} htmlFor="familyStatus">
        <Select id="familyStatus" value={data.familyStatus} onChange={(e) => onChange("familyStatus", e.target.value as WizardData["family"]["familyStatus"])}>
          <option value="MIDDLE_CLASS">Middle</option>
          <option value="UPPER_MIDDLE_CLASS">Upper Middle</option>
          <option value="UPPER_CLASS">Affluent</option>
          <option value="WELL_SETTLED">Prefer Not to Say</option>
        </Select>
      </Field>
      <Field label={t("familyLocation")} htmlFor="familyLocation">
        <Input id="familyLocation" value={data.familyLocation} onChange={(e) => onChange("familyLocation", e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Field label={t("familyBackground")} htmlFor="familyBackground">
          <Textarea
            id="familyBackground"
            value={data.familyBackground}
            onChange={(e) => onChange("familyBackground", e.target.value)}
            placeholder={t("familyBackgroundPlaceholder")}
            rows={4}
          />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Additional Family Information" htmlFor="additionalInfo">
          <Textarea id="additionalInfo" value={data.additionalInfo} onChange={(e) => onChange("additionalInfo", e.target.value)} />
        </Field>
      </div>
    </div>
  );
}
