"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { nativePlugin, installationId, postJson, readNativeInfo, SENSITIVE_PATH, type NativeInfo } from "@/lib/mobile/native";
import { pushPermissionGranted } from "@/lib/mobile/native-push";

// The bridge between the web pages and the app shell (STEP 37). It does nothing in an ordinary browser. Inside the Android / iPhone app it:
//   - asks the server whether this app version may still be used (blocks with an update screen if not), and reads the server-controlled feature switches,
//   - registers the app installation once the person is signed in, and keeps the push token current,
//   - opens links and notification taps ONLY after the server has said the person may open them,
//   - offers an optional device lock (biometrics) that never leaves the phone,
//   - hides sensitive screens from screenshots and the app switcher where the phone allows it,
//   - counts a few anonymous usage events (names only).
// It never stores a login credential: the session is the website's own cookie session, kept by the app's web view.

interface VersionAnswer { status: "OK" | "UPDATE_RECOMMENDED" | "UPDATE_REQUIRED"; message: string | null; storeUrl: string | null; enabled: boolean }
interface ConfigAnswer { flags: Record<string, boolean>; maintenance: boolean; message: string }

const REGISTER_EVERY_MS = 10 * 60_000;
const LOCK_AFTER_MS = 30_000;

export function NativeBridge() {
  const router = useRouter();
  const pathname = usePathname();
  const [info, setInfo] = useState<NativeInfo | null>(null);
  const [version, setVersion] = useState<VersionAnswer | null>(null);
  const [config, setConfig] = useState<ConfigAnswer | null>(null);
  const [locked, setLocked] = useState(false);
  const [dismissedUpdate, setDismissedUpdate] = useState(false);
  const installRef = useRef<string>("");
  const registeredAt = useRef(0);
  const lastTry = useRef(0);
  const biometricOn = useRef(false);
  const lastActive = useRef(0); // set when the app starts (a clock read is not allowed while rendering)
  const configRef = useRef<ConfigAnswer | null>(null);

  const track = useCallback((event: string, nativeInfo: NativeInfo) => {
    void postJson("/api/mobile/events", { platform: nativeInfo.platform, appVersion: nativeInfo.version, events: [event] });
  }, []);

  const openLink = useCallback(async (url: string) => {
    if (configRef.current && !configRef.current.flags.deep_links) return;
    const r = await postJson("/api/mobile/deep-link/resolve", { url });
    if (r.status === 200 && r.json.allowed === true && typeof r.json.path === "string") {
      router.push(r.json.path);
    } else if (r.status === 401 && typeof r.json.path === "string") {
      try {
        sessionStorage.setItem("lpp_pending_link", url);
      } catch {
        /* ignore */
      }
      router.push(r.json.path);
    }
    // Any other answer: the link is not for this person, or not valid. Nothing is opened and nothing is explained.
  }, [router]);

  const register = useCallback(async (nativeInfo: NativeInfo, force = false) => {
    if (!force && (Date.now() - registeredAt.current < REGISTER_EVERY_MS || Date.now() - lastTry.current < 15_000)) return;
    lastTry.current = Date.now();
    const id = installRef.current || (installRef.current = await installationId());
    const device = nativePlugin("Device");
    let osVersion: string | undefined;
    let deviceLabel: string | undefined;
    try {
      const d = (await device?.getInfo?.()) as { model?: string; osVersion?: string; operatingSystem?: string } | undefined;
      osVersion = d?.osVersion ? `${d.operatingSystem ?? ""} ${d.osVersion}`.trim().slice(0, 32) : undefined;
      deviceLabel = d?.model?.slice(0, 80);
    } catch {
      /* optional */
    }
    const r = await postJson("/api/mobile/devices", { installationId: id, platform: nativeInfo.platform, appVersion: nativeInfo.version, osVersion, deviceLabel });
    if (r.status === 201 || r.status === 200) {
      registeredAt.current = Date.now();
      const device = (r.json.device ?? {}) as { biometricEnabled?: boolean };
      biometricOn.current = device.biometricEnabled === true;
      let pending: string | null = null;
      try {
        pending = sessionStorage.getItem("lpp_pending_link");
        if (pending) sessionStorage.removeItem("lpp_pending_link");
      } catch {
        /* ignore */
      }
      if (pending) void openLink(pending);
      if (await pushPermissionGranted()) await nativePlugin("PushNotifications")?.register?.();
    } else if (r.status === 426) {
      setVersion({ status: "UPDATE_REQUIRED", message: typeof r.json.error === "string" ? r.json.error : "Please update Life Partner Pro to continue.", storeUrl: typeof r.json.storeUrl === "string" ? r.json.storeUrl : null, enabled: true });
    }
  }, [openLink]);

  // Start-up: version, switches, listeners.
  useEffect(() => {
    const n = readNativeInfo();
    if (!n) return;
    setInfo(n);
    lastActive.current = Date.now();
    let cancelled = false;
    const handles: Array<{ remove?: () => unknown } | undefined> = [];

    (async () => {
      const id = (installRef.current = await installationId());
      const [v, c] = await Promise.all([
        fetch(`/api/mobile/version?platform=${n.platform}&version=${encodeURIComponent(n.version)}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<VersionAnswer>) : null)).catch(() => null),
        fetch(`/api/mobile/config?platform=${n.platform}&installationId=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<ConfigAnswer>) : null)).catch(() => null),
      ]);
      if (cancelled) return;
      if (v) setVersion(v);
      if (c) {
        setConfig(c);
        configRef.current = c;
      }
      track("APP_OPENED", n);
      if (!v || v.status !== "UPDATE_REQUIRED") await register(n, true);

      const push = nativePlugin("PushNotifications");
      const app = nativePlugin("App");
      handles.push((await push?.addListener?.("registration", async (t: unknown) => {
        const value = (t as { value?: string })?.value;
        if (value) await postJson("/api/mobile/push/register", { installationId: id, token: value });
      })) as never);
      handles.push((await push?.addListener?.("pushNotificationReceived", () => track("PUSH_RECEIVED", n))) as never);
      handles.push((await push?.addListener?.("pushNotificationActionPerformed", (a: unknown) => {
        track("NOTIFICATION_OPENED", n);
        const path = (a as { notification?: { data?: { p?: string } } })?.notification?.data?.p;
        if (typeof path === "string") void openLink(path);
      })) as never);
      handles.push((await app?.addListener?.("appUrlOpen", (e: unknown) => {
        const url = (e as { url?: string })?.url;
        if (typeof url === "string") void openLink(url);
      })) as never);
      handles.push((await app?.addListener?.("appStateChange", (e: unknown) => {
        const active = (e as { isActive?: boolean })?.isActive === true;
        if (active) {
          if (biometricOn.current && configRef.current?.flags.biometric && Date.now() - lastActive.current > LOCK_AFTER_MS && nativePlugin("BiometricAuth")) setLocked(true);
          void register(n);
        } else lastActive.current = Date.now();
      })) as never);
    })();

    return () => {
      cancelled = true;
      for (const h of handles) void h?.remove?.();
    };
  }, [openLink, register, track]);

  // Re-register after a sign-in (the person moved on from the login page) without waiting for the timer.
  useEffect(() => {
    if (info && version?.status !== "UPDATE_REQUIRED") void register(info);
  }, [pathname, info, version?.status, register]);

  // Hide sensitive screens from screenshots / the app switcher.
  useEffect(() => {
    if (!info) return;
    const screen = nativePlugin("PrivacyScreen");
    if (!screen) return;
    void (SENSITIVE_PATH.test(pathname) ? screen.enable?.() : screen.disable?.());
  }, [pathname, info]);

  async function unlock() {
    try {
      await nativePlugin("BiometricAuth")?.authenticate?.({ reason: "Unlock Life Partner Pro", allowDeviceCredential: true });
      lastActive.current = Date.now();
      setLocked(false);
    } catch {
      /* stays locked */
    }
  }

  async function signOutThisDevice() {
    // The recovery path: removing this device signs its session out, whatever happened to the biometric.
    const id = installRef.current;
    const list = await fetch(`/api/mobile/devices?installationId=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const current = (list?.items as Array<{ id: string; isCurrent: boolean }> | undefined)?.find((d) => d.isCurrent);
    if (current) await fetch(`/api/mobile/devices/${current.id}`, { method: "DELETE" }).catch(() => null);
    setLocked(false);
    router.push("/login");
  }

  if (!info) return null;
  const blocked = version?.status === "UPDATE_REQUIRED" || config?.maintenance === true || version?.enabled === false;

  if (locked) {
    return (
      <div role="dialog" aria-modal="true" aria-label="Life Partner Pro is locked" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h2 className="font-heading text-xl font-semibold">Life Partner Pro is locked</h2>
        <p className="max-w-xs text-sm text-muted">Use your fingerprint, face or device passcode to continue.</p>
        <Button onClick={unlock}>Unlock</Button>
        <button type="button" onClick={signOutThisDevice} className="text-sm text-primary underline">Can&apos;t unlock? Sign out of this device</button>
      </div>
    );
  }

  if (blocked) {
    const required = version?.status === "UPDATE_REQUIRED";
    return (
      <div role="alertdialog" aria-modal="true" aria-label={required ? "Update required" : "Service notice"} className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <h2 className="font-heading text-xl font-semibold">{required ? "Please update Life Partner Pro" : "Life Partner Pro is unavailable right now"}</h2>
        <p className="max-w-xs text-sm text-muted">{required ? (version?.message ?? "Please update Life Partner Pro to continue.") : (config?.message || "We are carrying out maintenance. Please try again shortly.")}</p>
        {required && version?.storeUrl && <Button onClick={() => window.open(version.storeUrl as string, "_blank")}>Update</Button>}
      </div>
    );
  }

  if (version?.status === "UPDATE_RECOMMENDED" && !dismissedUpdate) {
    return (
      <div role="status" className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3 text-sm shadow-lg">
        <span>{version.message ?? "A newer version of Life Partner Pro is available."}</span>
        <span className="flex shrink-0 gap-2">
          {version.storeUrl && <Button size="sm" onClick={() => window.open(version.storeUrl as string, "_blank")}>Update</Button>}
          <Button size="sm" variant="outline" onClick={() => setDismissedUpdate(true)}>Later</Button>
        </span>
      </div>
    );
  }
  return null;
}
