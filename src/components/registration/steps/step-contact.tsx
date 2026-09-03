import { Field, Input, Select } from "@/components/ui/form";
import { Lock } from "lucide-react";
import type { WizardData } from "@/components/registration/wizard-types";

export function StepContact({
  data,
  errors,
  onChange,
}: {
  data: WizardData["contact"];
  errors: Record<string, string>;
  onChange: <K extends keyof WizardData["contact"]>(field: K, value: WizardData["contact"][K]) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-muted p-3 text-sm text-muted">
        <Lock className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
        <p>Your contact details are kept strictly private and are only ever visible to authorized administrators.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Mobile Number" error={errors.mobileNumber} htmlFor="mobileNumber">
          <Input id="mobileNumber" value={data.mobileNumber} onChange={(e) => onChange("mobileNumber", e.target.value)} placeholder="+92 300 1234567" />
        </Field>
        <Field label="WhatsApp Number" htmlFor="whatsappNumber">
          <Input id="whatsappNumber" value={data.whatsappNumber} onChange={(e) => onChange("whatsappNumber", e.target.value)} placeholder="+92 300 1234567" />
        </Field>
        <Field label="Email" error={errors.email} htmlFor="email">
          <Input id="email" type="email" value={data.email} onChange={(e) => onChange("email", e.target.value)} placeholder="you@example.com" />
        </Field>
        <Field label="Preferred Contact Method" htmlFor="preferredContactMethod">
          <Select
            id="preferredContactMethod"
            value={data.preferredContactMethod}
            onChange={(e) => onChange("preferredContactMethod", e.target.value as WizardData["contact"]["preferredContactMethod"])}
          >
            <option value="PHONE">Phone</option>
            <option value="WHATSAPP">WhatsApp</option>
            <option value="EMAIL">Email</option>
          </Select>
        </Field>
      </div>
    </div>
  );
}
