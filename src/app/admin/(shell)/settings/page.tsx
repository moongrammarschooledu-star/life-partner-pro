"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

interface Settings {
  appName: string;
  contactEmail: string | null;
  contactWhatsapp: string | null;
  contactAddress: string | null;
  weightAge: number;
  weightLocation: number;
  weightEducation: number;
  weightProfession: number;
  weightIncome: number;
  weightMaritalStatus: number;
  weightHeight: number;
  weightFamily: number;
  weightReligious: number;
  weightLifestyle: number;
}

const WEIGHT_FIELDS: { key: keyof Settings; label: string }[] = [
  { key: "weightAge", label: "Age" },
  { key: "weightLocation", label: "Location" },
  { key: "weightEducation", label: "Education" },
  { key: "weightProfession", label: "Profession" },
  { key: "weightIncome", label: "Income" },
  { key: "weightMaritalStatus", label: "Marital Status" },
  { key: "weightHeight", label: "Height" },
  { key: "weightFamily", label: "Family" },
  { key: "weightReligious", label: "Religious" },
  { key: "weightLifestyle", label: "Lifestyle" },
];

export default function SettingsPage() {
  const { show } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => r.json())
      .then(setSettings);
  }, []);

  async function save() {
    if (!settings) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) throw new Error();
      show("Settings saved", "success");
    } catch {
      show("Could not save settings.", "error");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const weightTotal = WEIGHT_FIELDS.reduce((sum, f) => sum + Number(settings[f.key] ?? 0), 0);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-muted">General app configuration and matching weights.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">General</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="App Name" htmlFor="appName">
            <Input id="appName" value={settings.appName} onChange={(e) => setSettings({ ...settings, appName: e.target.value })} />
          </Field>
          <Field label="Contact Email" htmlFor="contactEmail">
            <Input id="contactEmail" value={settings.contactEmail ?? ""} onChange={(e) => setSettings({ ...settings, contactEmail: e.target.value })} />
          </Field>
          <Field label="Contact WhatsApp" htmlFor="contactWhatsapp">
            <Input id="contactWhatsapp" value={settings.contactWhatsapp ?? ""} onChange={(e) => setSettings({ ...settings, contactWhatsapp: e.target.value })} />
          </Field>
          <Field label="Address" htmlFor="contactAddress">
            <Input id="contactAddress" value={settings.contactAddress ?? ""} onChange={(e) => setSettings({ ...settings, contactAddress: e.target.value })} />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Matching Weights</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={`text-sm mb-4 ${weightTotal === 100 ? "text-muted" : "text-danger"}`}>
            Total: {weightTotal}% {weightTotal !== 100 && "(should total 100%)"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {WEIGHT_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} htmlFor={f.key}>
                <Input
                  id={f.key}
                  type="number"
                  min={0}
                  max={100}
                  value={settings[f.key] as number}
                  onChange={(e) => setSettings({ ...settings, [f.key]: Number(e.target.value) })}
                />
              </Field>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Coming Soon</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted">
          <p className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Two-Factor Authentication — not yet enforced
          </p>
          <p className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> CSV / Excel / PDF export
          </p>
          <p className="flex items-center gap-2">
            <Lock className="h-4 w-4" /> Email / SMS / WhatsApp notification delivery
          </p>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Settings
      </Button>
    </div>
  );
}
