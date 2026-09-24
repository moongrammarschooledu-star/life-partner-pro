"use client";

import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface PartnerPreference {
  minAge: number | null;
  maxAge: number | null;
  preferredCountry: string | null;
  preferredCity: string | null;
  minEducation: string | null;
  professionPreference: string | null;
  maritalStatusPreference: string | null;
  minHeightCm: number | null;
  maxHeightCm: number | null;
  familyTypePreference: string | null;
  additionalExpectations: string | null;
  agePriority: string | null;
  locationPriority: string | null;
  professionPriority: string | null;
}

const PRIORITY_OPTIONS = ["MUST_HAVE", "PREFERRED", "FLEXIBLE"];

function PriorityField({ label, value, onChange }: { label: string; value: string | null; onChange: (v: string) => void }) {
  return (
    <Field label={label} htmlFor={label}>
      <Select id={label} value={value ?? "PREFERRED"} onChange={(e) => onChange(e.target.value)}>
        {PRIORITY_OPTIONS.map((p) => <option key={p} value={p}>{p.replace("_", " ")}</option>)}
      </Select>
    </Field>
  );
}

// STEP 21 Decision 2 — self-service, immediate write (no admin review):
// PartnerPreference only narrows which candidates get proposed, carrying no
// fraud/eligibility risk.
export default function PartnerRequirementsPage() {
  const { show } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pref, setPref] = useState<Partial<PartnerPreference>>({});

  useEffect(() => {
    fetch("/api/my-profile/partner-preference")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setPref(j?.preference ?? {}))
      .finally(() => setLoading(false));
  }, []);

  function set<K extends keyof PartnerPreference>(key: K, value: PartnerPreference[K]) {
    setPref((p) => ({ ...p, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/my-profile/partner-preference", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pref),
      });
      const json = await res.json();
      if (!res.ok) {
        show(json.error ?? "Could not save.", "error");
        return;
      }
      show("Partner requirements updated.", "success");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Partner Requirements</h1>
        <p className="mt-1 text-sm text-muted">Changes here take effect immediately — no admin review needed.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Preferences</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Min Age" htmlFor="minAge"><Input id="minAge" type="number" value={pref.minAge ?? ""} onChange={(e) => set("minAge", e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label="Max Age" htmlFor="maxAge"><Input id="maxAge" type="number" value={pref.maxAge ?? ""} onChange={(e) => set("maxAge", e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label="Preferred Country" htmlFor="preferredCountry"><Input id="preferredCountry" value={pref.preferredCountry ?? ""} onChange={(e) => set("preferredCountry", e.target.value)} /></Field>
          <Field label="Preferred City" htmlFor="preferredCity"><Input id="preferredCity" value={pref.preferredCity ?? ""} onChange={(e) => set("preferredCity", e.target.value)} /></Field>
          <Field label="Min Education" htmlFor="minEducation"><Input id="minEducation" value={pref.minEducation ?? ""} onChange={(e) => set("minEducation", e.target.value)} /></Field>
          <Field label="Profession Preference" htmlFor="professionPreference"><Input id="professionPreference" value={pref.professionPreference ?? ""} onChange={(e) => set("professionPreference", e.target.value)} /></Field>
          <Field label="Min Height (cm)" htmlFor="minHeightCm"><Input id="minHeightCm" type="number" value={pref.minHeightCm ?? ""} onChange={(e) => set("minHeightCm", e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label="Max Height (cm)" htmlFor="maxHeightCm"><Input id="maxHeightCm" type="number" value={pref.maxHeightCm ?? ""} onChange={(e) => set("maxHeightCm", e.target.value ? Number(e.target.value) : null)} /></Field>
          <Field label="Family Type Preference" htmlFor="familyTypePreference"><Input id="familyTypePreference" value={pref.familyTypePreference ?? ""} onChange={(e) => set("familyTypePreference", e.target.value)} /></Field>
          <div className="sm:col-span-2">
            <Field label="Additional Expectations" htmlFor="additionalExpectations"><Textarea id="additionalExpectations" value={pref.additionalExpectations ?? ""} onChange={(e) => set("additionalExpectations", e.target.value)} /></Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">How Strict Should These Be?</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <PriorityField label="Age" value={pref.agePriority ?? null} onChange={(v) => set("agePriority", v)} />
          <PriorityField label="Location" value={pref.locationPriority ?? null} onChange={(v) => set("locationPriority", v)} />
          <PriorityField label="Profession" value={pref.professionPriority ?? null} onChange={(v) => set("professionPriority", v)} />
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
      </Button>
    </div>
  );
}
