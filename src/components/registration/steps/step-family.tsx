import { Field, Input, Select, Textarea } from "@/components/ui/form";
import type { WizardData } from "@/components/registration/wizard-types";

export function StepFamily({
  data,
  onChange,
}: {
  data: WizardData["family"];
  onChange: <K extends keyof WizardData["family"]>(field: K, value: WizardData["family"][K]) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Father's Occupation" htmlFor="fatherOccupation">
        <Input id="fatherOccupation" value={data.fatherOccupation} onChange={(e) => onChange("fatherOccupation", e.target.value)} />
      </Field>
      <Field label="Mother's Occupation" htmlFor="motherOccupation">
        <Input id="motherOccupation" value={data.motherOccupation} onChange={(e) => onChange("motherOccupation", e.target.value)} />
      </Field>
      <Field label="Number of Brothers" htmlFor="numberOfBrothers">
        <Input id="numberOfBrothers" type="number" min={0} value={data.numberOfBrothers} onChange={(e) => onChange("numberOfBrothers", e.target.value)} />
      </Field>
      <Field label="Number of Sisters" htmlFor="numberOfSisters">
        <Input id="numberOfSisters" type="number" min={0} value={data.numberOfSisters} onChange={(e) => onChange("numberOfSisters", e.target.value)} />
      </Field>
      <Field label="Family Type" htmlFor="familyType">
        <Select id="familyType" value={data.familyType} onChange={(e) => onChange("familyType", e.target.value as WizardData["family"]["familyType"])}>
          <option value="NUCLEAR">Nuclear</option>
          <option value="JOINT">Joint</option>
          <option value="EXTENDED">Extended</option>
        </Select>
      </Field>
      <Field label="Family Status" htmlFor="familyStatus">
        <Select id="familyStatus" value={data.familyStatus} onChange={(e) => onChange("familyStatus", e.target.value as WizardData["family"]["familyStatus"])}>
          <option value="MIDDLE_CLASS">Middle Class</option>
          <option value="UPPER_MIDDLE_CLASS">Upper Middle Class</option>
          <option value="UPPER_CLASS">Upper Class</option>
          <option value="WELL_SETTLED">Well Settled</option>
        </Select>
      </Field>
      <Field label="Family Location" htmlFor="familyLocation">
        <Input id="familyLocation" value={data.familyLocation} onChange={(e) => onChange("familyLocation", e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Family Background" htmlFor="familyBackground">
          <Textarea id="familyBackground" value={data.familyBackground} onChange={(e) => onChange("familyBackground", e.target.value)} />
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
