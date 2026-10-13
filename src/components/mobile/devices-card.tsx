"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/utils";
import { installationId, nativePlugin, postJson, readNativeInfo, type NativeInfo } from "@/lib/mobile/native";
import { enableNativePush } from "@/lib/mobile/native-push";

// "Your devices" (STEP 37 §11, §13, §18, §21): the phones and tablets signed in to the Life Partner Pro app, what their lock-screen notifications may show,
// and the choice to remove one. Removing a device signs it out. No token or internal identifier is ever shown.

interface Device { id: string; platform: "ANDROID" | "IOS"; deviceLabel: string | null; appVersion: string; osVersion: string | null; lastSeenAt: string; isCurrent: boolean; pushEnabled: boolean; displayMode: string | null; biometricEnabled: boolean }

const MODES = [
  { value: "PRIVATE", label: "Private: “You have a new update” (recommended)" },
  { value: "FULL", label: "Full: the short update title" },
  { value: "MINIMAL", label: "Minimal: just “Open the app”" },
  { value: "OFF", label: "Off: no notifications" },
];

export function DevicesCard({ scope }: { scope: "APPLICANT" | "FAMILY" }) {
  const { show } = useToast();
  const [items, setItems] = useState<Device[] | null>(null);
  const [native, setNative] = useState<NativeInfo | null>(null);
  const [accountMode, setAccountMode] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);

  const load = useCallback(async () => {
    const n = readNativeInfo();
    setNative(n);
    const id = n ? await installationId() : "";
    const [d, p] = await Promise.all([
      fetch(`/api/mobile/devices${id ? `?installationId=${encodeURIComponent(id)}` : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).catch(() => ({ items: [] })),
      scope === "APPLICANT" ? fetch("/api/mobile/preferences", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
    ]);
    setItems(d.items ?? []);
    setAccountMode(p?.pushDisplayMode ?? null);
    try {
      const bio = (await nativePlugin("BiometricAuth")?.checkBiometry?.()) as { isAvailable?: boolean } | undefined;
      setBiometricAvailable(bio?.isAvailable === true);
    } catch {
      setBiometricAvailable(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  async function patchDevice(id: string, body: Record<string, unknown>, done: string) {
    setBusy(id);
    const res = await fetch(`/api/mobile/devices/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(null);
    if (res.ok) {
      show(done, "success");
      await load();
    } else show((await res.json().catch(() => ({}))).error ?? "That did not work.", "error");
  }

  async function remove(d: Device) {
    setBusy(d.id);
    const res = await fetch(`/api/mobile/devices/${d.id}`, { method: "DELETE" });
    setBusy(null);
    if (res.ok) {
      show(d.isCurrent ? "Signed out of this device." : "Device removed and signed out.", "success");
      if (d.isCurrent) window.location.href = scope === "FAMILY" ? "/family/dashboard" : "/login";
      else await load();
    } else show("Could not remove the device.", "error");
  }

  async function turnOnNotifications() {
    if (!native) return;
    const r = await enableNativePush(native.platform);
    show(r === "granted" ? "Notifications are on for this device." : r === "denied" ? "Notifications are blocked in your phone's settings." : "Notifications are not available on this device.", r === "granted" ? "success" : "error");
    // the phone sends its token back to the app a moment later
    window.setTimeout(() => void load(), 1500);
  }

  async function toggleBiometric(d: Device) {
    if (!d.biometricEnabled) {
      try {
        await nativePlugin("BiometricAuth")?.authenticate?.({ reason: "Confirm to turn on the app lock", allowDeviceCredential: true });
      } catch {
        show("The app lock was not turned on.", "error");
        return;
      }
    }
    await patchDevice(d.id, { biometricEnabled: !d.biometricEnabled }, d.biometricEnabled ? "App lock turned off." : "App lock turned on.");
  }

  async function sendTest(d: Device) {
    setBusy(d.id);
    const id = native ? await installationId() : "";
    const r = await postJson("/api/mobile/push/test", { installationId: id });
    setBusy(null);
    const result = r.json.result;
    show(result === "SENT" ? "A test notification was sent." : result === "NOT_CONFIGURED" ? "Notifications are not set up on the server yet." : result === "NO_TOKEN" ? "This device has not turned on notifications." : r.status === 429 ? "Please wait a few minutes before another test." : "The test could not be sent.", result === "SENT" ? "success" : "error");
  }

  async function saveAccountMode(value: string) {
    const res = await fetch("/api/mobile/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pushDisplayMode: value }) });
    if (res.ok) {
      setAccountMode(value);
      show("Notification style saved.", "success");
    } else show("Could not save that.", "error");
  }

  if (items === null) return <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted" /></div>;
  // On the website, with no app signed in, there is nothing to show: the card appears once an app is in use.
  if (items.length === 0 && !native) return null;
  const here = items.find((d) => d.isCurrent);

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Smartphone className="h-4 w-4" /> Your devices &amp; notifications</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {scope === "APPLICANT" && accountMode && (
          <label className="block text-sm">
            <span className="font-medium">What a notification may show on your lock screen</span>
            <Select className="mt-1" value={accountMode} onChange={(e) => void saveAccountMode(e.target.value)}>
              {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
            <span className="mt-1 block text-xs text-muted">Notifications never include names, phone numbers or proposal details.</span>
          </label>
        )}

        {native && (!here || !here.pushEnabled) && (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">Turn on notifications on this device</p>
            <p className="mt-1 text-muted">We will tell you when something needs your attention, such as a proposal update. Your phone will ask for permission. You can turn this off at any time.</p>
            <Button className="mt-2" size="sm" onClick={turnOnNotifications}>Turn on notifications</Button>
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-muted">No phone or tablet is signed in to the Life Partner Pro app yet.</p>
        ) : (
          items.map((d) => (
            <div key={d.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{d.deviceLabel ?? (d.platform === "ANDROID" ? "Android device" : "iPhone or iPad")}{d.isCurrent ? " (this device)" : ""}</p>
                  <p className="text-xs text-muted">{d.platform === "ANDROID" ? "Android" : "iOS"}{d.osVersion ? ` · ${d.osVersion}` : ""} · app {d.appVersion} · last used {formatDateTime(d.lastSeenAt)}</p>
                </div>
                <div className="flex gap-2">
                  {d.pushEnabled && d.isCurrent && <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => sendTest(d)}>Send a test</Button>}
                  <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => remove(d)}>{d.isCurrent ? "Sign out" : "Remove"}</Button>
                </div>
              </div>
              <label className="block text-xs">
                <span className="text-muted">Notifications on this device</span>
                <Select className="mt-1" value={d.displayMode ?? ""} onChange={(e) => void patchDevice(d.id, { displayMode: e.target.value === "" ? null : e.target.value }, "Saved.")}>
                  <option value="">{scope === "APPLICANT" ? "Follow my account setting" : "Private (default)"}</option>
                  {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </Select>
              </label>
              {d.isCurrent && biometricAvailable && (
                <Button size="sm" variant="outline" disabled={busy === d.id} onClick={() => toggleBiometric(d)}>{d.biometricEnabled ? "Turn off app lock" : "Lock the app with fingerprint / face"}</Button>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
