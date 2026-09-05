"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Checkbox } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ALGORITHM_VERSION } from "@/lib/matching";

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
  weightLanguages: number;
  thresholdExcellent: number;
  thresholdVeryGood: number;
  thresholdGood: number;
  thresholdPossible: number;
  hardRequirementAge: boolean;
  hardRequirementLocation: boolean;
  hardRequirementEducation: boolean;
  hardRequirementProfession: boolean;
  hardRequirementIncome: boolean;
  hardRequirementMaritalStatus: boolean;
  hardRequirementHeight: boolean;
  hardRequirementFamily: boolean;
  hardRequirementReligious: boolean;
  hardRequirementLifestyle: boolean;
  hardRequirementLanguages: boolean;
  categoryEnabledAge: boolean;
  categoryEnabledLocation: boolean;
  categoryEnabledEducation: boolean;
  categoryEnabledProfession: boolean;
  categoryEnabledIncome: boolean;
  categoryEnabledMaritalStatus: boolean;
  categoryEnabledHeight: boolean;
  categoryEnabledFamily: boolean;
  categoryEnabledReligious: boolean;
  categoryEnabledLifestyle: boolean;
  categoryEnabledLanguages: boolean;
  maxMatchResults: number;
  excludeHardRequirementFailures: boolean;
  documentVerificationEnabled: boolean;
  allowPartiallyVerifiedManualMatch: boolean;
  removeFromPoolDuringReVerification: boolean;
  autoReVerificationOnKeyFieldChange: boolean;
  otpExpiryMinutes: number;
  otpMaxAttempts: number;
}

const WEIGHT_FIELDS: { key: keyof Settings; label: string; hardKey: keyof Settings; enabledKey: keyof Settings }[] = [
  { key: "weightAge", label: "Age", hardKey: "hardRequirementAge", enabledKey: "categoryEnabledAge" },
  { key: "weightLocation", label: "Location", hardKey: "hardRequirementLocation", enabledKey: "categoryEnabledLocation" },
  { key: "weightEducation", label: "Education", hardKey: "hardRequirementEducation", enabledKey: "categoryEnabledEducation" },
  { key: "weightProfession", label: "Profession", hardKey: "hardRequirementProfession", enabledKey: "categoryEnabledProfession" },
  { key: "weightIncome", label: "Income", hardKey: "hardRequirementIncome", enabledKey: "categoryEnabledIncome" },
  { key: "weightMaritalStatus", label: "Marital Status", hardKey: "hardRequirementMaritalStatus", enabledKey: "categoryEnabledMaritalStatus" },
  { key: "weightHeight", label: "Height", hardKey: "hardRequirementHeight", enabledKey: "categoryEnabledHeight" },
  { key: "weightFamily", label: "Family", hardKey: "hardRequirementFamily", enabledKey: "categoryEnabledFamily" },
  { key: "weightReligious", label: "Religious", hardKey: "hardRequirementReligious", enabledKey: "categoryEnabledReligious" },
  { key: "weightLifestyle", label: "Lifestyle", hardKey: "hardRequirementLifestyle", enabledKey: "categoryEnabledLifestyle" },
  { key: "weightLanguages", label: "Languages", hardKey: "hardRequirementLanguages", enabledKey: "categoryEnabledLanguages" },
];

const THRESHOLD_FIELDS: { key: keyof Settings; label: string }[] = [
  { key: "thresholdExcellent", label: "Excellent" },
  { key: "thresholdVeryGood", label: "Very Good" },
  { key: "thresholdGood", label: "Good" },
  { key: "thresholdPossible", label: "Possible" },
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

  const enabledFields = WEIGHT_FIELDS.filter((f) => settings[f.enabledKey] !== false);
  const weightTotal = enabledFields.reduce((sum, f) => sum + Number(settings[f.key] ?? 0), 0);

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
          <p className="text-sm mb-1 text-muted">Enabled categories total: {weightTotal}%</p>
          <p className="text-xs text-muted mb-4">
            Weights don&apos;t need to sum to exactly 100 — the engine automatically normalizes against whichever categories are
            enabled. Disabling a category removes it from scoring entirely. Marking a category as a hard requirement excludes
            candidates who fail it, instead of just lowering their score (unless &quot;Exclude Hard Requirement Failures&quot;
            below is off, in which case they&apos;re shown with a warning for admin review).
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {WEIGHT_FIELDS.map((f) => (
              <div key={f.key} className="flex items-end gap-3">
                <Field label={f.label} htmlFor={f.key} className="flex-1">
                  <Input
                    id={f.key}
                    type="number"
                    min={0}
                    max={100}
                    disabled={!settings[f.enabledKey]}
                    value={settings[f.key] as number}
                    onChange={(e) => setSettings({ ...settings, [f.key]: Number(e.target.value) })}
                  />
                </Field>
                <Checkbox
                  label="Enabled"
                  checked={settings[f.enabledKey] as boolean}
                  onChange={(e) => setSettings({ ...settings, [f.enabledKey]: e.target.checked })}
                />
                <Checkbox
                  label="Hard requirement"
                  checked={settings[f.hardKey] as boolean}
                  disabled={!settings[f.enabledKey]}
                  onChange={(e) => setSettings({ ...settings, [f.hardKey]: e.target.checked })}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Match Tier Thresholds</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted mb-4">Minimum overall compatibility score (%) required to reach each tier.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {THRESHOLD_FIELDS.map((f) => (
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
          <CardTitle className="text-base">Matching Center Behavior</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Maximum Results" htmlFor="maxMatchResults" hint="Default number of ranked matches returned per search.">
            <Input
              id="maxMatchResults"
              type="number"
              min={1}
              max={100}
              value={settings.maxMatchResults}
              onChange={(e) => setSettings({ ...settings, maxMatchResults: Number(e.target.value) })}
            />
          </Field>
          <Checkbox
            label="Exclude Hard Requirement Failures from results (default: off, so borderline cases stay visible for review)"
            checked={settings.excludeHardRequirementFailures}
            onChange={(e) => setSettings({ ...settings, excludeHardRequirementFailures: e.target.checked })}
          />
          <p className="text-xs text-muted">
            Algorithm Version: <span className="font-medium text-foreground">{ALGORITHM_VERSION}</span> (read-only — tied to the
            deployed scoring logic, not an editable preference).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verification &amp; Trust</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Checkbox
            label="Enable document verification (optional identity/education/employment document review)"
            checked={settings.documentVerificationEnabled}
            onChange={(e) => setSettings({ ...settings, documentVerificationEnabled: e.target.checked })}
          />
          <Checkbox
            label="Allow Super Admin to manually match partially-verified profiles (widens the Matching Center's 'Include all eligible statuses' override)"
            checked={settings.allowPartiallyVerifiedManualMatch}
            onChange={(e) => setSettings({ ...settings, allowPartiallyVerifiedManualMatch: e.target.checked })}
          />
          <Checkbox
            label="Remove a profile from the active matching pool while re-verification is required"
            checked={settings.removeFromPoolDuringReVerification}
            onChange={(e) => setSettings({ ...settings, removeFromPoolDuringReVerification: e.target.checked })}
          />
          <Checkbox
            label="Automatically require re-verification when contact information changes"
            checked={settings.autoReVerificationOnKeyFieldChange}
            onChange={(e) => setSettings({ ...settings, autoReVerificationOnKeyFieldChange: e.target.checked })}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="OTP Expiry (minutes)" htmlFor="otpExpiryMinutes">
              <Input
                id="otpExpiryMinutes"
                type="number"
                min={1}
                max={60}
                value={settings.otpExpiryMinutes}
                onChange={(e) => setSettings({ ...settings, otpExpiryMinutes: Number(e.target.value) })}
              />
            </Field>
            <Field label="OTP Max Attempts" htmlFor="otpMaxAttempts">
              <Input
                id="otpMaxAttempts"
                type="number"
                min={1}
                max={10}
                value={settings.otpMaxAttempts}
                onChange={(e) => setSettings({ ...settings, otpMaxAttempts: Number(e.target.value) })}
              />
            </Field>
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
